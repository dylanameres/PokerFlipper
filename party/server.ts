import { routePartykitRequest, Server, type Connection } from "partyserver";
import {
  BIG_BLIND,
  HOLE_COUNT,
  MAX_ONLINE_PLAYERS,
  MIN_BET,
  SMALL_BLIND,
  STARTING_CHIPS,
  type ClientMessage,
  type GameType,
  type RoomView,
  type ServerMessage,
  type Street,
  type WireCard,
} from "../shared/protocol";
import { scoreHand } from "../src/poker/equity";

type Seat = {
  connectionId: string | null;
  holes: WireCard[];
  chips: number;
  betStreet: number;
  folded: boolean;
  acted: boolean;
};

export type Env = {
  PokerRoom: DurableObjectNamespace<PokerRoom>;
};

function fullDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** Cryptographically shuffled deck (runs on Cloudflare Workers). */
function secureShuffle(deck: number[]): number[] {
  const cards = deck.slice();
  const rand = new Uint32Array(1);
  for (let i = cards.length - 1; i > 0; i--) {
    crypto.getRandomValues(rand);
    const j = rand[0] % (i + 1);
    const tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }
  return cards;
}

function emptyBoard(): WireCard[] {
  return [null, null, null, null, null];
}

function emptyHoles(n: number): WireCard[] {
  return Array.from({ length: n }, () => null);
}

export class PokerRoom extends Server<Env> {
  gameType: GameType = "holdem";
  street: Street = "predeal";
  deck: number[] = [];
  board: WireCard[] = emptyBoard();
  seats: Seat[] = [];
  hostId: string | null = null;
  pot = 0;
  currentBet = 0;
  actionSeat: number | null = null;
  bettingOpen = false;
  handOver = false;
  winnerSeats: number[] = [];
  /** Heads-up dealer button (= small blind). Rotates left each dealt hand. */
  buttonSeat = 0;
  /** Hands successfully dealt this room session (drives blind rotation). */
  private handsDealt = 0;
  private seatsReady = false;

  private holes(): number {
    return HOLE_COUNT[this.gameType];
  }

  private ensureSeats() {
    if (this.seatsReady) return;
    this.seats = Array.from({ length: MAX_ONLINE_PLAYERS }, () => ({
      connectionId: null,
      holes: emptyHoles(this.holes()),
      chips: STARTING_CHIPS,
      betStreet: 0,
      folded: false,
      acted: false,
    }));
    this.seatsReady = true;
  }

  private newRoundKeepSeats() {
    this.street = "predeal";
    this.board = emptyBoard();
    this.deck = [];
    this.pot = 0;
    this.currentBet = 0;
    this.actionSeat = null;
    this.bettingOpen = false;
    this.handOver = false;
    this.winnerSeats = [];
    for (const seat of this.seats) {
      seat.holes = emptyHoles(this.holes());
      seat.betStreet = 0;
      seat.folded = false;
      seat.acted = false;
    }
  }

  private smallBlindSeat(): number {
    return this.buttonSeat;
  }

  private bigBlindSeat(): number {
    return 1 - this.buttonSeat;
  }

  private postBlinds() {
    const sb = this.smallBlindSeat();
    const bb = this.bigBlindSeat();
    this.putChips(this.seats[sb], SMALL_BLIND);
    this.putChips(this.seats[bb], BIG_BLIND);
    this.currentBet = Math.max(
      this.seats[sb].betStreet,
      this.seats[bb].betStreet,
    );
  }

  private draw(n: number): number[] {
    if (n > this.deck.length) {
      throw new Error("Deck exhausted");
    }
    return this.deck.splice(0, n);
  }

  private activeSeats(): number[] {
    return this.seats
      .map((s, i) => (s.connectionId && !s.folded ? i : -1))
      .filter((i) => i >= 0);
  }

  private seatIndexOf(connectionId: string): number {
    return this.seats.findIndex((s) => s.connectionId === connectionId);
  }

  private putChips(seat: Seat, amount: number) {
    const n = Math.min(amount, seat.chips);
    seat.chips -= n;
    seat.betStreet += n;
    this.pot += n;
    return n;
  }

  /** Preflop after blinds: SB (button) acts first in heads-up. */
  private startPreflopBetting() {
    for (const seat of this.seats) {
      seat.acted = false;
    }
    const active = this.activeSeats();
    if (active.length < 2) {
      this.bettingOpen = false;
      this.actionSeat = null;
      return;
    }
    // If someone is already all-in from blinds, still let the other act if needed.
    const bothAllIn = active.every((i) => this.seats[i].chips === 0);
    if (bothAllIn) {
      this.bettingOpen = false;
      this.actionSeat = null;
      return;
    }
    this.bettingOpen = true;
    this.actionSeat = this.smallBlindSeat();
    if (!active.includes(this.actionSeat) || this.seats[this.actionSeat].chips === 0) {
      this.actionSeat = this.bigBlindSeat();
    }
    if (!active.includes(this.actionSeat)) {
      this.bettingOpen = false;
      this.actionSeat = null;
    }
  }

  /** Postflop: BB acts first in heads-up; button acts last. */
  private startBettingRound() {
    this.currentBet = 0;
    for (const seat of this.seats) {
      seat.betStreet = 0;
      seat.acted = false;
    }
    const active = this.activeSeats();
    if (active.length < 2 || active.every((i) => this.seats[i].chips === 0)) {
      this.bettingOpen = false;
      this.actionSeat = null;
      if (this.street === "river") {
        this.showdown();
      }
      return;
    }
    this.bettingOpen = true;
    const bb = this.bigBlindSeat();
    this.actionSeat = active.includes(bb) ? bb : active[0];
  }

  private bettingRoundComplete(): boolean {
    const active = this.activeSeats();
    if (active.length <= 1) return true;
    for (const i of active) {
      const s = this.seats[i];
      if (!s.acted) return false;
      const matched = s.betStreet === this.currentBet;
      const allInShort = s.chips === 0 && s.betStreet <= this.currentBet;
      if (!matched && !allInShort) return false;
    }
    return true;
  }

  private afterAction() {
    if (this.activeSeats().length <= 1) {
      this.finishByFold();
      return;
    }
    if (!this.bettingRoundComplete()) {
      this.advanceAction();
      return;
    }
    this.bettingOpen = false;
    this.actionSeat = null;
    if (this.street === "river") {
      this.showdown();
    }
  }

  private advanceAction() {
    const active = this.activeSeats();
    if (active.length === 0 || this.actionSeat === null) {
      this.actionSeat = null;
      return;
    }
    const start = this.actionSeat;
    for (let step = 1; step <= MAX_ONLINE_PLAYERS; step++) {
      const next = (start + step) % MAX_ONLINE_PLAYERS;
      if (!active.includes(next)) continue;
      const s = this.seats[next];
      const needsAction =
        !s.acted || (s.betStreet < this.currentBet && s.chips > 0);
      if (needsAction) {
        this.actionSeat = next;
        return;
      }
    }
    this.actionSeat = null;
  }

  private finishByFold() {
    this.bettingOpen = false;
    this.actionSeat = null;
    this.handOver = true;
    this.rotateButtonNextHand = true;
    const winners = this.activeSeats();
    this.winnerSeats = winners;
    for (const i of winners) {
      this.seats[i].chips += this.pot;
    }
    this.pot = 0;
  }

  private showdown() {
    this.bettingOpen = false;
    this.actionSeat = null;
    this.handOver = true;
    this.rotateButtonNextHand = true;
    const active = this.activeSeats();
    if (active.length === 0) {
      this.winnerSeats = [];
      return;
    }
    if (active.length === 1) {
      this.winnerSeats = active;
      this.seats[active[0]].chips += this.pot;
      this.pot = 0;
      return;
    }

    const board = this.board.filter((c): c is number => c !== null);
    const scores = active.map((i) => {
      const holes = this.seats[i].holes.filter((c): c is number => c !== null);
      return scoreHand(this.gameType, holes, board);
    });
    const best = Math.max(...scores);
    const winners = active.filter((_, idx) => scores[idx] === best);
    this.winnerSeats = winners;
    const share = Math.floor(this.pot / winners.length);
    let remainder = this.pot - share * winners.length;
    for (const i of winners) {
      this.seats[i].chips += share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    }
    this.pot = 0;
  }

  private requireActor(sender: Connection): number {
    if (!this.bettingOpen || this.handOver) {
      throw new Error("Betting is closed");
    }
    const seat = this.seatIndexOf(sender.id);
    if (seat < 0) throw new Error("You are not seated");
    if (this.seats[seat].folded) throw new Error("You already folded");
    if (seat !== this.actionSeat) throw new Error("Not your turn");
    return seat;
  }

  onStart() {
    this.ensureSeats();
  }

  onConnect(conn: Connection) {
    this.ensureSeats();
    let seatIndex = this.seats.findIndex((s) => s.connectionId === null);
    if (seatIndex === -1) {
      this.send(conn, {
        type: "error",
        message: "Room is full (2 players).",
      });
      conn.close(4000, "Room full");
      return;
    }

    this.seats[seatIndex].connectionId = conn.id;
    if (!this.hostId) this.hostId = conn.id;

    this.broadcastViews();
  }

  onClose(conn: Connection) {
    this.ensureSeats();
    for (const seat of this.seats) {
      if (seat.connectionId === conn.id) {
        seat.connectionId = null;
      }
    }
    if (this.hostId === conn.id) {
      const next = this.seats.find((s) => s.connectionId);
      this.hostId = next?.connectionId ?? null;
    }
    this.broadcastViews();
  }

  onMessage(sender: Connection, message: string | ArrayBuffer) {
    this.ensureSeats();
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(message)) as ClientMessage;
    } catch {
      this.send(sender, { type: "error", message: "Bad message" });
      return;
    }

    try {
      this.handle(msg, sender);
    } catch (err) {
      this.send(sender, {
        type: "error",
        message: err instanceof Error ? err.message : "Server error",
      });
    }
  }

  private handle(msg: ClientMessage, sender: Connection) {
    const isHost = sender.id === this.hostId;

    switch (msg.type) {
      case "hello": {
        if (isHost && this.street === "predeal") {
          this.gameType = msg.gameType;
          for (const seat of this.seats) {
            if (seat.holes.length !== this.holes()) {
              seat.holes = emptyHoles(this.holes());
            }
          }
        }
        this.broadcastViews();
        return;
      }
      case "deal_hands": {
        if (!isHost) throw new Error("Only the host can deal");
        if (!this.bothSeated()) throw new Error("Need 2 players");
        if (this.street !== "predeal" && !this.handOver) {
          throw new Error("Finish the hand first");
        }
        // Rebuy if anyone is broke.
        if (this.seats.some((s) => s.chips <= 0)) {
          for (const seat of this.seats) seat.chips = STARTING_CHIPS;
        }
        if (this.rotateButtonNextHand) {
          this.buttonSeat = 1 - this.buttonSeat;
          this.rotateButtonNextHand = false;
        }
        this.deck = secureShuffle(fullDeck());
        this.board = emptyBoard();
        this.pot = 0;
        this.currentBet = 0;
        this.handOver = false;
        this.winnerSeats = [];
        const n = this.holes();
        for (const seat of this.seats) {
          seat.holes = emptyHoles(n);
          seat.folded = false;
          seat.betStreet = 0;
          seat.acted = false;
        }
        for (let h = 0; h < n; h++) {
          for (let p = 0; p < MAX_ONLINE_PLAYERS; p++) {
            seatAssign(this.seats[p], h, this.draw(1)[0]);
          }
        }
        this.street = "holes";
        this.postBlinds();
        this.startPreflopBetting();
        this.broadcastViews();
        return;
      }
      case "deal_flop": {
        this.requireHostDeal(isHost, "holes");
        this.draw(1);
        const flop = this.draw(3);
        this.board[0] = flop[0];
        this.board[1] = flop[1];
        this.board[2] = flop[2];
        this.street = "flop";
        this.startBettingRound();
        this.broadcastViews();
        return;
      }
      case "deal_turn": {
        this.requireHostDeal(isHost, "flop");
        this.draw(1);
        this.board[3] = this.draw(1)[0];
        this.street = "turn";
        this.startBettingRound();
        this.broadcastViews();
        return;
      }
      case "deal_river": {
        this.requireHostDeal(isHost, "turn");
        this.draw(1);
        this.board[4] = this.draw(1)[0];
        this.street = "river";
        this.startBettingRound();
        this.broadcastViews();
        return;
      }
      case "new_round": {
        if (!isHost) throw new Error("Only the host can start a new round");
        this.newRoundKeepSeats();
        this.broadcastViews();
        return;
      }
      case "fold": {
        const seat = this.requireActor(sender);
        this.seats[seat].folded = true;
        this.seats[seat].acted = true;
        this.afterAction();
        this.broadcastViews();
        return;
      }
      case "call": {
        const seat = this.requireActor(sender);
        const s = this.seats[seat];
        const toCall = Math.max(0, this.currentBet - s.betStreet);
        if (toCall > 0) this.putChips(s, toCall);
        s.acted = true;
        this.afterAction();
        this.broadcastViews();
        return;
      }
      case "bet": {
        const seat = this.requireActor(sender);
        const s = this.seats[seat];
        const amount = Math.floor(Number(msg.amount));
        if (!Number.isFinite(amount)) throw new Error("Invalid bet");
        const maxTotal = s.betStreet + s.chips;
        if (this.currentBet === 0) {
          if (amount < MIN_BET && amount !== maxTotal) {
            throw new Error(`Min bet is ${MIN_BET}`);
          }
          if (amount < 1) throw new Error("Bet must be positive");
        } else {
          const minRaiseTo = this.currentBet + MIN_BET;
          if (amount < minRaiseTo && amount !== maxTotal) {
            throw new Error(`Min raise is to ${minRaiseTo}`);
          }
          if (amount <= this.currentBet && amount !== maxTotal) {
            throw new Error("Raise must be larger than the current bet");
          }
        }
        if (amount > maxTotal) throw new Error("Not enough chips");
        const add = amount - s.betStreet;
        if (add < 0) throw new Error("Invalid bet");
        this.putChips(s, add);
        this.currentBet = s.betStreet;
        s.acted = true;
        // Everyone else still in must respond.
        for (let i = 0; i < this.seats.length; i++) {
          if (i === seat || this.seats[i].folded) continue;
          this.seats[i].acted = false;
        }
        this.afterAction();
        this.broadcastViews();
        return;
      }
      default:
        throw new Error("Unknown message");
    }
  }

  private requireHostDeal(isHost: boolean, expected: Street) {
    if (!isHost) throw new Error("Only the host can deal");
    if (this.handOver) throw new Error("Hand is over — deal hands for a new one");
    if (this.street !== expected) throw new Error("Wrong street");
    if (this.bettingOpen || !this.bettingRoundComplete()) {
      throw new Error("Finish betting first");
    }
  }

  private bothSeated(): boolean {
    return this.seats.every((s) => s.connectionId !== null);
  }

  private send(conn: Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcastViews() {
    for (const conn of this.getConnections()) {
      this.send(conn, this.viewFor(conn.id));
    }
  }

  private viewFor(connectionId: string): RoomView {
    const yourSeat = this.seatIndexOf(connectionId);
    // Reveal opponent holes only after a full river showdown.
    const doReveal = this.handOver && this.street === "river" && this.board[4] !== null;

    const n = this.holes();
    let yourHoles: WireCard[] = emptyHoles(n);
    let opponentHidden: boolean[] = Array.from({ length: n }, () => false);
    let opponentHoles: WireCard[] | null = null;

    if (yourSeat >= 0) {
      yourHoles = this.seats[yourSeat].holes.slice();
      const opp = this.seats[1 - yourSeat];
      const oppDealt = opp.holes.every((c) => c !== null);
      if (doReveal) {
        opponentHoles = opp.holes.slice();
        opponentHidden = Array.from({ length: n }, () => false);
      } else if (oppDealt || this.street !== "predeal") {
        opponentHidden = opp.holes.map((c) => c !== null);
      }
    }

    const toCall =
      yourSeat >= 0
        ? Math.max(0, this.currentBet - this.seats[yourSeat].betStreet)
        : 0;
    const your = yourSeat >= 0 ? this.seats[yourSeat] : null;
    const maxBet = your ? your.betStreet + your.chips : 0;
    const minBet =
      this.currentBet === 0
        ? Math.min(MIN_BET, maxBet || MIN_BET)
        : Math.min(Math.max(this.currentBet + MIN_BET, this.currentBet + 1), maxBet || this.currentBet + 1);
    const canAct =
      this.bettingOpen &&
      yourSeat >= 0 &&
      yourSeat === this.actionSeat &&
      !this.handOver;
    const bettingComplete =
      !this.bettingOpen &&
      !this.handOver &&
      this.street !== "predeal" &&
      this.bettingRoundComplete();

    let roomId = "";
    try {
      roomId = this.name;
    } catch {
      roomId = "";
    }

    const waiting = !this.bothSeated();
    let status: string;
    if (waiting) {
      status = roomId
        ? `Room ${roomId} — waiting for opponent…`
        : "Waiting for opponent…";
    } else if (this.street === "predeal") {
      status =
        connectionId === this.hostId
          ? "Both players ready. Deal hands when you want."
          : "Waiting for host to deal.";
    } else if (this.handOver) {
      if (this.winnerSeats.length === 2) status = "Chop — pot split.";
      else if (this.winnerSeats.length === 1) {
        const w = this.winnerSeats[0];
        status =
          yourSeat === w ? "You win the pot." : `P${w + 1} wins the pot.`;
      } else {
        status = "Hand over.";
      }
    } else if (this.bettingOpen && this.actionSeat !== null) {
      status =
        yourSeat === this.actionSeat
          ? toCall > 0
            ? `Your turn — ${toCall} to call.`
            : "Your turn — check or bet."
          : `Waiting for P${this.actionSeat + 1}…`;
    } else if (bettingComplete) {
      status =
        connectionId === this.hostId
          ? "Betting done — deal the next street."
          : "Betting done — waiting for host.";
    } else {
      status = "Playing…";
    }

    const inHand = this.street !== "predeal";
    const sb = this.smallBlindSeat();
    const bb = this.bigBlindSeat();

    return {
      type: "state",
      roomId,
      gameType: this.gameType,
      street: this.street,
      yourSeat: yourSeat >= 0 ? yourSeat : null,
      youAreHost: connectionId === this.hostId,
      seats: this.seats.map((s, i) => ({
        filled: s.connectionId !== null,
        connected: s.connectionId !== null,
        chips: s.chips,
        bet: s.betStreet,
        folded: s.folded,
        isButton: inHand && i === this.buttonSeat,
        isSmallBlind: inHand && i === sb,
        isBigBlind: inHand && i === bb,
      })),
      board: this.board.slice(),
      yourHoles,
      opponentHidden,
      opponentHoles,
      revealed: doReveal,
      status,
      pot: this.pot,
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
      buttonSeat: inHand ? this.buttonSeat : null,
      toCall,
      minBet,
      maxBet,
      canAct,
      canCheck: canAct && toCall === 0,
      canBet: canAct && maxBet > this.currentBet,
      bettingOpen: this.bettingOpen,
      bettingComplete,
      handOver: this.handOver,
      winnerSeats: this.winnerSeats.slice(),
      actionSeat: this.actionSeat,
    };
  }
}

function seatAssign(seat: Seat, slot: number, card: number) {
  seat.holes[slot] = card;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
};
