import { routePartykitRequest, Server, type Connection } from "partyserver";
import {
  BIG_BLIND,
  HOLE_COUNT,
  MAX_ONLINE_PLAYERS,
  MIN_BET,
  ROOM_PROTOCOL,
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
  /** Current-hand action lines for the history panel. */
  private history: string[] = [];

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

  /** One seat to the left (same direction blinds rotate). */
  private seatLeftOf(seat: number): number {
    return (seat - 1 + MAX_ONLINE_PLAYERS) % MAX_ONLINE_PLAYERS;
  }

  /**
   * Heads-up: dealer posts the small blind.
   * Multi-way (future): SB is left of the button.
   */
  private smallBlindSeat(): number {
    if (MAX_ONLINE_PLAYERS === 2) return this.buttonSeat;
    return this.seatLeftOf(this.buttonSeat);
  }

  /** Heads-up: the non-dealer posts the big blind. */
  private bigBlindSeat(): number {
    if (MAX_ONLINE_PLAYERS === 2) return this.seatLeftOf(this.buttonSeat);
    return this.seatLeftOf(this.smallBlindSeat());
  }

  private seatLabel(seat: number): string {
    return `P${seat + 1}`;
  }

  private pushHistory(line: string) {
    this.history.push(line);
    if (this.history.length > 80) {
      this.history.splice(0, this.history.length - 80);
    }
  }

  private formatCard(card: number): string {
    const ranks = "23456789TJQKA";
    const suits = "shdc";
    return `${ranks[card >> 2]}${suits[card & 3]}`;
  }

  private formatCards(cards: number[]): string {
    return cards.map((c) => this.formatCard(c)).join(" ");
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
    this.pushHistory(
      `${this.seatLabel(sb)} posts SB ${this.seats[sb].betStreet}`,
    );
    this.pushHistory(
      `${this.seatLabel(bb)} posts BB ${this.seats[bb].betStreet}`,
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

  /** First active seat at or left of `from` (walking left). */
  private firstActiveLeftOf(from: number): number | null {
    for (let step = 1; step <= MAX_ONLINE_PLAYERS; step++) {
      const seat =
        (from - step + MAX_ONLINE_PLAYERS) % MAX_ONLINE_PLAYERS;
      if (this.activeSeats().includes(seat) && this.seats[seat].chips > 0) {
        return seat;
      }
    }
    const active = this.activeSeats();
    return active[0] ?? null;
  }

  /** Preflop: first to act is left of the big blind. */
  private startPreflopBetting() {
    for (const seat of this.seats) {
      seat.acted = false;
    }
    // Short all-in from blinds still counts as having acted for round completion.
    for (const i of this.activeSeats()) {
      if (this.seats[i].chips === 0) this.seats[i].acted = true;
    }
    const active = this.activeSeats();
    if (active.length < 2) {
      this.bettingOpen = false;
      this.actionSeat = null;
      return;
    }
    const bothAllIn = active.every((i) => this.seats[i].chips === 0);
    if (bothAllIn) {
      this.bettingOpen = false;
      this.actionSeat = null;
      return;
    }
    this.bettingOpen = true;
    this.actionSeat = this.firstActiveLeftOf(this.bigBlindSeat());
    if (this.actionSeat === null) {
      this.bettingOpen = false;
    }
  }

  /** Postflop: first to act is left of the button. */
  private startBettingRound() {
    this.currentBet = 0;
    for (const seat of this.seats) {
      seat.betStreet = 0;
      seat.acted = false;
    }
    // All-in players cannot act — mark them acted so the round can complete.
    for (const i of this.activeSeats()) {
      if (this.seats[i].chips === 0) this.seats[i].acted = true;
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
    this.actionSeat = this.firstActiveLeftOf(this.buttonSeat);
    if (this.actionSeat === null) {
      this.bettingOpen = false;
    }
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
    // #region agent log
    console.log(
      JSON.stringify({
        sessionId: "4e23",
        location: "server.ts:afterAction",
        message: "afterAction",
        data: {
          street: this.street,
          complete: this.bettingRoundComplete(),
          active: this.activeSeats(),
          acted: this.seats.map((s) => s.acted),
          bets: this.seats.map((s) => s.betStreet),
          chips: this.seats.map((s) => s.chips),
          currentBet: this.currentBet,
          actionSeat: this.actionSeat,
        },
        timestamp: Date.now(),
        hypothesisId: "A",
      }),
    );
    // #endregion
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
    this.onBettingComplete();
  }

  /** After a betting round ends, showdown or auto-deal the next board street. */
  private onBettingComplete() {
    // #region agent log
    console.log(
      JSON.stringify({
        sessionId: "4e23",
        location: "server.ts:onBettingComplete",
        message: "onBettingComplete enter",
        data: {
          street: this.street,
          bettingOpen: this.bettingOpen,
          handOver: this.handOver,
          board: this.board.slice(),
        },
        timestamp: Date.now(),
        hypothesisId: "B",
      }),
    );
    // #endregion
    if (this.street === "river") {
      this.showdown();
      return;
    }
    this.dealNextBoardStreet();
    // All-in runout: keep dealing until river/showdown.
    while (!this.bettingOpen && !this.handOver && this.street !== "river") {
      this.dealNextBoardStreet();
    }
    if (!this.bettingOpen && !this.handOver && this.street === "river") {
      this.showdown();
    }
    // #region agent log
    console.log(
      JSON.stringify({
        sessionId: "4e23",
        location: "server.ts:onBettingComplete",
        message: "onBettingComplete exit",
        data: {
          street: this.street,
          bettingOpen: this.bettingOpen,
          handOver: this.handOver,
          board: this.board.slice(),
          actionSeat: this.actionSeat,
        },
        timestamp: Date.now(),
        hypothesisId: "B",
      }),
    );
    // #endregion
  }

  private dealNextBoardStreet() {
    const from = this.street;
    if (this.street === "holes") {
      this.draw(1);
      const flop = this.draw(3);
      this.board[0] = flop[0];
      this.board[1] = flop[1];
      this.board[2] = flop[2];
      this.street = "flop";
      this.pushHistory(`Flop ${this.formatCards(flop)}`);
    } else if (this.street === "flop") {
      this.draw(1);
      const turn = this.draw(1)[0];
      this.board[3] = turn;
      this.street = "turn";
      this.pushHistory(`Turn ${this.formatCard(turn)}`);
    } else if (this.street === "turn") {
      this.draw(1);
      const river = this.draw(1)[0];
      this.board[4] = river;
      this.street = "river";
      this.pushHistory(`River ${this.formatCard(river)}`);
    } else {
      // #region agent log
      console.log(
        JSON.stringify({
          sessionId: "4e23",
          location: "server.ts:dealNextBoardStreet",
          message: "early return wrong street",
          data: { street: this.street },
          timestamp: Date.now(),
          hypothesisId: "B",
        }),
      );
      // #endregion
      return;
    }
    // #region agent log
    console.log(
      JSON.stringify({
        sessionId: "4e23",
        location: "server.ts:dealNextBoardStreet",
        message: "dealt street",
        data: { from, to: this.street, board: this.board.slice() },
        timestamp: Date.now(),
        hypothesisId: "B",
      }),
    );
    // #endregion
    this.startBettingRound();
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
    const winners = this.activeSeats();
    this.winnerSeats = winners;
    const won = this.pot;
    for (const i of winners) {
      this.seats[i].chips += won;
    }
    this.pot = 0;
    if (winners.length === 1) {
      this.pushHistory(`${this.seatLabel(winners[0])} wins ${won}`);
    }
  }

  private showdown() {
    this.bettingOpen = false;
    this.actionSeat = null;
    this.handOver = true;
    const active = this.activeSeats();
    if (active.length === 0) {
      this.winnerSeats = [];
      return;
    }
    if (active.length === 1) {
      this.winnerSeats = active;
      const won = this.pot;
      this.seats[active[0]].chips += this.pot;
      this.pot = 0;
      this.pushHistory(`${this.seatLabel(active[0])} wins ${won}`);
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
    const won = this.pot;
    const share = Math.floor(this.pot / winners.length);
    let remainder = this.pot - share * winners.length;
    for (const i of winners) {
      this.seats[i].chips += share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    }
    this.pot = 0;
    if (winners.length === 2) {
      this.pushHistory(`Chop — split ${won}`);
    } else if (winners.length === 1) {
      this.pushHistory(`${this.seatLabel(winners[0])} wins ${won}`);
    }
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
        // Rotate blinds left each new hand (skip the very first deal).
        if (this.handsDealt > 0) {
          this.buttonSeat =
            (this.buttonSeat - 1 + MAX_ONLINE_PLAYERS) % MAX_ONLINE_PLAYERS;
        }
        this.deck = secureShuffle(fullDeck());
        this.board = emptyBoard();
        this.pot = 0;
        this.currentBet = 0;
        this.handOver = false;
        this.winnerSeats = [];
        this.history = [];
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
        // Blinds post immediately when hole cards are dealt.
        this.street = "holes";
        this.handsDealt += 1;
        this.pushHistory(`Hand #${this.handsDealt}`);
        this.pushHistory(`${this.seatLabel(this.buttonSeat)} is dealer`);
        this.postBlinds();
        this.startPreflopBetting();
        if (!this.bettingOpen && !this.handOver) {
          this.onBettingComplete();
        }
        this.broadcastViews();
        return;
      }
      case "deal_flop":
      case "deal_turn":
      case "deal_river": {
        // Streets auto-deal after betting; host deal_* is an idempotent fallback.
        const expected =
          msg.type === "deal_flop"
            ? "holes"
            : msg.type === "deal_turn"
              ? "flop"
              : "turn";
        if (!isHost) throw new Error("Only the host can deal");
        // Already advanced (server auto-deal won the race) — no-op.
        if (this.street !== expected) {
          this.broadcastViews();
          return;
        }
        if (this.handOver) {
          throw new Error("Hand is over — deal hands for a new one");
        }
        if (this.bettingOpen || !this.bettingRoundComplete()) {
          throw new Error("Finish betting first");
        }
        this.onBettingComplete();
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
        this.pushHistory(`${this.seatLabel(seat)} folds`);
        this.afterAction();
        this.broadcastViews();
        return;
      }
      case "call": {
        const seat = this.requireActor(sender);
        const s = this.seats[seat];
        const toCall = Math.max(0, this.currentBet - s.betStreet);
        if (toCall > 0) {
          this.putChips(s, toCall);
          this.pushHistory(`${this.seatLabel(seat)} calls ${toCall}`);
        } else {
          this.pushHistory(`${this.seatLabel(seat)} checks`);
        }
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
        const wasBet = this.currentBet === 0;
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
        this.pushHistory(
          wasBet
            ? `${this.seatLabel(seat)} bets ${amount}`
            : `${this.seatLabel(seat)} raises to ${amount}`,
        );
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
      status = "Dealing next street…";
    } else {
      status = "Playing…";
    }

    const inHand = this.street !== "predeal";
    const sb = this.smallBlindSeat();
    const bb = this.bigBlindSeat();

    return {
      type: "state",
      protocol: ROOM_PROTOCOL,
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
      history: this.history.slice(),
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
