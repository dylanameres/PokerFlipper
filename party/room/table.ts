import {
  BIG_BLIND,
  HOLE_COUNT,
  MAX_ONLINE_PLAYERS,
  MIN_BET,
  MIN_ONLINE_PLAYERS,
  ROOM_PROTOCOL,
  SMALL_BLIND,
  STARTING_CHIPS,
  type ClientMessage,
  type GameType,
  type RoomView,
  type SeatPublic,
  type Street,
  type WireCard,
} from "../../shared/protocol";
import { scoreHand } from "../../src/poker/equity";
import {
  assignHole,
  emptyBoard,
  emptyHoles,
  fullDeck,
  secureShuffle,
} from "./deck";
import type { RoomSeat } from "./types";

export type TableNotify = () => void;

/**
 * Pure room engine: seating, blinds, betting, deal, showdown.
 * PartyServer / Workers transport lives in `party/server.ts`.
 */
export class PokerTable {
  gameType: GameType = "holdem";
  street: Street = "predeal";
  deck: number[] = [];
  board: WireCard[] = emptyBoard();
  seats: RoomSeat[] = [];
  hostId: string | null = null;
  pot = 0;
  currentBet = 0;
  actionSeat: number | null = null;
  bettingOpen = false;
  handOver = false;
  winnerSeats: number[] = [];
  /** Dealer button (heads-up: also BB). Rotates left among filled seats. */
  buttonSeat = 0;
  /** SB/BB seats fixed at deal time (do not recompute after disconnects). */
  private sbSeatFixed: number | null = null;
  private bbSeatFixed: number | null = null;
  private handsDealt = 0;
  private seatsReady = false;
  private history: string[] = [];
  private runoutGen = 0;
  private static readonly RUNOUT_PAUSE_MS = 900;

  constructor(private readonly notify: TableNotify) {}

  private holes(): number {
    return HOLE_COUNT[this.gameType];
  }

  ensureSeats() {
    if (this.seatsReady) return;
    this.seats = Array.from({ length: MAX_ONLINE_PLAYERS }, () =>
      this.freshSeat(),
    );
    this.seatsReady = true;
  }

  private freshSeat(): RoomSeat {
    return {
      connectionId: null,
      holes: emptyHoles(this.holes()),
      chips: STARTING_CHIPS,
      betStreet: 0,
      folded: false,
      acted: false,
      inHand: false,
    };
  }

  seatedCount(): number {
    let n = 0;
    for (const s of this.seats) {
      if (s.connectionId !== null) n += 1;
    }
    return n;
  }

  filledSeats(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i].connectionId !== null) out.push(i);
    }
    return out;
  }

  readyToDeal(): boolean {
    return this.seatedCount() >= MIN_ONLINE_PLAYERS;
  }

  private handInProgress(): boolean {
    return this.street !== "predeal" && !this.handOver;
  }

  /** Seat a joining connection into the first empty chair. */
  seatPlayer(
    connectionId: string,
  ): { ok: true; seat: number } | { ok: false; message: string } {
    this.ensureSeats();
    const existing = this.seatIndexOf(connectionId);
    if (existing >= 0) return { ok: true, seat: existing };

    const seatIndex = this.seats.findIndex((s) => s.connectionId === null);
    if (seatIndex === -1) {
      return {
        ok: false,
        message: `Room is full (${MAX_ONLINE_PLAYERS} players).`,
      };
    }

    // Wipe prior occupant state — never inherit holes/stack/hand flags.
    const seat = this.seats[seatIndex];
    seat.connectionId = connectionId;
    seat.holes = emptyHoles(this.holes());
    seat.chips = STARTING_CHIPS;
    seat.betStreet = 0;
    seat.folded = false;
    seat.acted = false;
    // Late joiners sit out until the next deal.
    seat.inHand = false;
    if (!this.hostId) this.hostId = connectionId;
    return { ok: true, seat: seatIndex };
  }

  /**
   * Clear a connection from its seat; promote a new host if needed.
   * Mid-hand disconnects are treated like a fold so action/pot can resolve.
   */
  unseatPlayer(connectionId: string) {
    this.ensureSeats();
    const seatIndex = this.seatIndexOf(connectionId);
    if (seatIndex < 0) {
      if (this.hostId === connectionId) this.hostId = null;
      return;
    }

    const seat = this.seats[seatIndex];
    const wasLive =
      this.handInProgress() && seat.inHand && !seat.folded;

    // Scrub private cards before dropping the connection id.
    seat.holes = emptyHoles(this.holes());
    seat.connectionId = null;
    seat.inHand = false;
    seat.betStreet = 0;
    seat.folded = false;
    seat.acted = false;
    seat.chips = STARTING_CHIPS;

    if (this.hostId === connectionId) {
      const next = this.seats.find((s) => s.connectionId);
      this.hostId = next?.connectionId ?? null;
    }

    if (wasLive) {
      // Seat is already out of activeSeats; resolve like a fold.
      if (this.afterAction()) {
        // Caller (PartyRoom) broadcasts; runout path notifies itself.
      }
    }
  }

  handle(msg: ClientMessage, connectionId: string) {
    this.ensureSeats();
    const isHost = connectionId === this.hostId;

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
        this.notify();
        return;
      }
      case "deal_hands": {
        if (!isHost) throw new Error("Only the host can deal");
        if (!this.readyToDeal()) {
          throw new Error(`Need at least ${MIN_ONLINE_PLAYERS} players`);
        }
        if (this.street !== "predeal" && !this.handOver) {
          throw new Error("Finish the hand first");
        }
        // Rebuy broke seated players.
        for (const seat of this.seats) {
          if (seat.connectionId && seat.chips <= 0) {
            seat.chips = STARTING_CHIPS;
          }
        }
        this.ensureButtonOnFilledSeat();
        if (this.handsDealt > 0) {
          this.buttonSeat = this.seatLeftOfFilled(this.buttonSeat);
        }
        this.deck = secureShuffle(fullDeck());
        this.board = emptyBoard();
        this.pot = 0;
        this.currentBet = 0;
        this.handOver = false;
        this.winnerSeats = [];
        this.sbSeatFixed = null;
        this.bbSeatFixed = null;
        this.runoutGen += 1;
        const n = this.holes();
        const filled = this.filledSeats();
        for (const seat of this.seats) {
          seat.holes = emptyHoles(n);
          seat.folded = false;
          seat.betStreet = 0;
          seat.acted = false;
          seat.inHand = seat.connectionId !== null;
        }
        for (let h = 0; h < n; h++) {
          for (const p of filled) {
            assignHole(this.seats[p].holes, h, this.draw(1)[0]);
          }
        }
        this.street = "holes";
        this.handsDealt += 1;
        this.postBlinds();
        this.startPreflopBetting();
        if (!this.bettingOpen && !this.handOver) {
          void this.finishBettingAndMaybeRunout();
          return;
        }
        this.notify();
        return;
      }
      case "deal_flop":
      case "deal_turn":
      case "deal_river": {
        const expected =
          msg.type === "deal_flop"
            ? "holes"
            : msg.type === "deal_turn"
              ? "flop"
              : "turn";
        if (!isHost) throw new Error("Only the host can deal");
        if (this.street !== expected) {
          this.notify();
          return;
        }
        if (this.handOver) {
          throw new Error("Hand is over — deal hands for a new one");
        }
        if (this.bettingOpen || !this.bettingRoundComplete()) {
          throw new Error("Finish betting first");
        }
        void this.finishBettingAndMaybeRunout();
        return;
      }
      case "new_round": {
        if (!isHost) throw new Error("Only the host can start a new round");
        this.runoutGen += 1;
        this.newRoundKeepSeats();
        this.notify();
        return;
      }
      case "fold": {
        const seat = this.requireActor(connectionId);
        this.seats[seat].folded = true;
        this.seats[seat].acted = true;
        if (this.afterAction()) this.notify();
        return;
      }
      case "call": {
        const seat = this.requireActor(connectionId);
        const s = this.seats[seat];
        const toCall = Math.max(0, this.currentBet - s.betStreet);
        if (toCall > 0) this.putChips(s, toCall);
        s.acted = true;
        if (this.afterAction()) this.notify();
        return;
      }
      case "bet": {
        const seat = this.requireActor(connectionId);
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
        for (let i = 0; i < this.seats.length; i++) {
          if (i === seat || this.seats[i].folded) continue;
          if (!this.seats[i].connectionId) continue;
          if (this.seats[i].chips === 0) {
            this.seats[i].acted = true;
            continue;
          }
          this.seats[i].acted = false;
        }
        if (this.afterAction()) this.notify();
        return;
      }
      default:
        throw new Error("Unknown message");
    }
  }

  viewFor(connectionId: string, roomId: string): RoomView {
    this.ensureSeats();
    const yourSeat = this.seatIndexOf(connectionId);
    const doReveal =
      this.handOver && this.street === "river" && this.board[4] !== null;
    const n = this.holes();
    const filled = this.filledSeats();
    const seated = filled.length;
    const tableLive = this.street !== "predeal";

    let yourHoles: WireCard[] = emptyHoles(n);
    if (yourSeat >= 0) {
      yourHoles = this.seats[yourSeat].holes.slice();
    }

    // Deprecated HU helpers — only when exactly one other *in-hand* opponent.
    let opponentHidden: boolean[] | undefined;
    let opponentHoles: WireCard[] | null | undefined;
    const othersInHand = filled.filter(
      (i) => i !== yourSeat && this.seats[i].inHand,
    );
    if (yourSeat >= 0 && othersInHand.length === 1) {
      const opp = this.seats[othersInHand[0]];
      if (doReveal) {
        opponentHoles = opp.holes.slice();
        opponentHidden = Array.from({ length: n }, () => false);
      } else if (opp.inHand && this.street !== "predeal") {
        opponentHidden = opp.holes.map((c) => c !== null);
        opponentHoles = null;
      } else {
        opponentHidden = Array.from({ length: n }, () => false);
        opponentHoles = null;
      }
    }

    const your = yourSeat >= 0 ? this.seats[yourSeat] : null;
    const toCall =
      your && your.inHand
        ? Math.max(0, this.currentBet - your.betStreet)
        : 0;
    const maxBet = your && your.inHand ? your.betStreet + your.chips : 0;
    const minBet =
      this.currentBet === 0
        ? Math.min(MIN_BET, maxBet || MIN_BET)
        : Math.min(
            Math.max(this.currentBet + MIN_BET, this.currentBet + 1),
            maxBet || this.currentBet + 1,
          );
    const canAct =
      this.bettingOpen &&
      yourSeat >= 0 &&
      yourSeat === this.actionSeat &&
      !this.handOver &&
      Boolean(your?.inHand) &&
      (your?.chips ?? 0) > 0;
    const canBetSeats = this.seatsThatCanBet();
    const bettingComplete =
      !this.bettingOpen &&
      !this.handOver &&
      this.street !== "predeal" &&
      this.street !== "river" &&
      this.bettingRoundComplete() &&
      canBetSeats.length >= 2;

    const waiting = seated < MIN_ONLINE_PLAYERS;
    let status: string;
    if (waiting) {
      status = roomId
        ? `Room ${roomId} — ${seated}/${MIN_ONLINE_PLAYERS} players…`
        : `Waiting for players (${seated}/${MIN_ONLINE_PLAYERS})…`;
    } else if (this.street === "predeal") {
      status =
        connectionId === this.hostId
          ? `${seated} players ready. Deal hands when you want.`
          : "Waiting for host to deal.";
    } else if (
      yourSeat >= 0 &&
      !this.seats[yourSeat].inHand &&
      !this.handOver
    ) {
      status = "Sitting out — wait for the next hand.";
    } else if (this.handOver) {
      if (this.winnerSeats.length >= 2) status = "Chop — pot split.";
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
    } else if (
      !this.bettingOpen &&
      !this.handOver &&
      canBetSeats.length < 2 &&
      this.street !== "predeal"
    ) {
      status = "All-in — running out the board…";
    } else if (bettingComplete) {
      status = "Dealing next street…";
    } else {
      status = "Playing…";
    }

    const sb = tableLive ? (this.sbSeatFixed ?? -1) : -1;
    const bb = tableLive ? (this.bbSeatFixed ?? -1) : -1;

    const seats: SeatPublic[] = this.seats.map((s, i) => {
      const filledSeat = s.connectionId !== null;
      const pub: SeatPublic = {
        filled: filledSeat,
        connected: filledSeat,
        chips: s.chips,
        bet: s.betStreet,
        folded: s.folded,
        inHand: filledSeat ? s.inHand : false,
        // Blind/button markers use deal-time seats; never re-derive after leaves.
        isButton: tableLive && filledSeat && i === this.buttonSeat,
        isSmallBlind: tableLive && filledSeat && i === sb,
        isBigBlind: tableLive && filledSeat && i === bb,
      };
      if (!filledSeat || !s.inHand) return pub;

      // Own holes live in `yourHoles` only — avoid duplicating on the wire.
      if (i === yourSeat) return pub;

      if (doReveal) {
        pub.holes = s.holes.slice();
        pub.holeHidden = Array.from({ length: n }, () => false);
      } else {
        pub.holeHidden = s.holes.map((c) => c !== null);
      }
      return pub;
    });

    return {
      type: "state",
      protocol: ROOM_PROTOCOL,
      roomId,
      gameType: this.gameType,
      street: this.street,
      yourSeat: yourSeat >= 0 ? yourSeat : null,
      youAreHost: connectionId === this.hostId,
      seats,
      maxSeats: MAX_ONLINE_PLAYERS,
      seatedCount: seated,
      board: this.board.slice(),
      yourHoles,
      opponentHidden,
      opponentHoles,
      revealed: doReveal,
      status,
      pot: this.pot,
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
      buttonSeat: tableLive ? this.buttonSeat : null,
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

  // —— internals ————————————————————————————————————————————————

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
    this.sbSeatFixed = null;
    this.bbSeatFixed = null;
    for (const seat of this.seats) {
      seat.holes = emptyHoles(this.holes());
      seat.betStreet = 0;
      seat.folded = false;
      seat.acted = false;
      seat.inHand = false;
    }
  }

  /** One filled seat to the left (blinds / button rotate this way). */
  private seatLeftOfFilled(seat: number): number {
    for (let step = 1; step <= MAX_ONLINE_PLAYERS; step++) {
      const next = (seat - step + MAX_ONLINE_PLAYERS) % MAX_ONLINE_PLAYERS;
      if (this.seats[next]?.connectionId) return next;
    }
    return seat;
  }

  private ensureButtonOnFilledSeat() {
    if (this.seats[this.buttonSeat]?.connectionId) return;
    const filled = this.filledSeats();
    if (filled.length > 0) this.buttonSeat = filled[0];
  }

  private smallBlindSeat(): number {
    return this.seatLeftOfFilled(this.buttonSeat);
  }

  private bigBlindSeat(): number {
    return this.seatLeftOfFilled(this.smallBlindSeat());
  }

  private seatLabel(seat: number): string {
    return `P${seat + 1}`;
  }

  private pushHistory(line: string) {
    this.history.push(line);
    if (this.history.length > 40) {
      this.history.splice(0, this.history.length - 40);
    }
  }

  private recordHandResult(pot: number, winners: number[]) {
    let result: string;
    if (winners.length >= 2) {
      result = `Chop ${pot}`;
    } else if (winners.length === 1) {
      result = `${this.seatLabel(winners[0])} wins ${pot}`;
    } else {
      result = `Pot ${pot}`;
    }
    this.pushHistory(`#${this.handsDealt} ${result}`);
  }

  private postBlinds() {
    const sb = this.smallBlindSeat();
    const bb = this.bigBlindSeat();
    this.sbSeatFixed = sb;
    this.bbSeatFixed = bb;
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
    const out: number[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (s.connectionId && s.inHand && !s.folded) out.push(i);
    }
    return out;
  }

  private seatIndexOf(connectionId: string): number {
    return this.seats.findIndex((s) => s.connectionId === connectionId);
  }

  private putChips(seat: RoomSeat, amount: number) {
    const n = Math.min(amount, seat.chips);
    seat.chips -= n;
    seat.betStreet += n;
    this.pot += n;
    return n;
  }

  private seatsThatCanBet(): number[] {
    return this.activeSeats().filter((i) => this.seats[i].chips > 0);
  }

  /** First seat that can bet, walking left from `from` (exclusive). */
  private firstActiveLeftOf(from: number): number | null {
    const canBet = new Set(this.seatsThatCanBet());
    for (let step = 1; step <= MAX_ONLINE_PLAYERS; step++) {
      const seat =
        (from - step + MAX_ONLINE_PLAYERS) % MAX_ONLINE_PLAYERS;
      if (canBet.has(seat)) return seat;
    }
    return null;
  }

  private markAllInSeatsActed() {
    for (const i of this.activeSeats()) {
      if (this.seats[i].chips === 0) this.seats[i].acted = true;
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private startPreflopBetting() {
    for (const seat of this.seats) {
      seat.acted = false;
    }
    this.markAllInSeatsActed();
    const active = this.activeSeats();
    if (active.length < 2 || this.seatsThatCanBet().length < 2) {
      this.bettingOpen = false;
      this.actionSeat = null;
      return;
    }
    this.bettingOpen = true;
    const bb = this.bbSeatFixed ?? this.bigBlindSeat();
    this.actionSeat = this.firstActiveLeftOf(bb);
    if (this.actionSeat === null) {
      this.bettingOpen = false;
    }
  }

  private startBettingRound() {
    this.currentBet = 0;
    for (const seat of this.seats) {
      seat.betStreet = 0;
      seat.acted = false;
    }
    this.markAllInSeatsActed();
    const active = this.activeSeats();
    if (active.length < 2 || this.seatsThatCanBet().length < 2) {
      this.bettingOpen = false;
      this.actionSeat = null;
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
      if (s.chips === 0) continue;
      if (!s.acted) return false;
      if (s.betStreet !== this.currentBet) return false;
    }
    return true;
  }

  /**
   * @returns true if the caller should notify (action advanced / fold).
   * false if a runout was started (it notifies on its own).
   */
  private afterAction(): boolean {
    if (this.activeSeats().length <= 1) {
      this.finishByFold();
      return true;
    }
    if (!this.bettingRoundComplete()) {
      this.advanceAction();
      if (this.actionSeat === null) {
        this.bettingOpen = false;
        void this.finishBettingAndMaybeRunout();
        return false;
      }
      return true;
    }
    this.bettingOpen = false;
    this.actionSeat = null;
    void this.finishBettingAndMaybeRunout();
    return false;
  }

  private async finishBettingAndMaybeRunout() {
    const gen = ++this.runoutGen;
    if (this.street === "river") {
      this.showdown();
      this.notify();
      return;
    }

    this.dealNextBoardStreet();
    this.notify();

    while (
      gen === this.runoutGen &&
      !this.bettingOpen &&
      !this.handOver &&
      this.street !== "river"
    ) {
      if (this.street === "flop" || this.street === "turn") {
        await this.pause(PokerTable.RUNOUT_PAUSE_MS);
        if (gen !== this.runoutGen || this.handOver || this.bettingOpen) {
          if (gen === this.runoutGen) this.notify();
          return;
        }
      }
      this.dealNextBoardStreet();
      this.notify();
    }

    if (
      gen === this.runoutGen &&
      !this.bettingOpen &&
      !this.handOver &&
      this.street === "river"
    ) {
      this.showdown();
      this.notify();
    }
  }

  private dealNextBoardStreet() {
    if (this.street === "holes") {
      this.draw(1);
      const flop = this.draw(3);
      this.board[0] = flop[0];
      this.board[1] = flop[1];
      this.board[2] = flop[2];
      this.street = "flop";
    } else if (this.street === "flop") {
      this.draw(1);
      const turn = this.draw(1)[0];
      this.board[3] = turn;
      this.street = "turn";
    } else if (this.street === "turn") {
      this.draw(1);
      const river = this.draw(1)[0];
      this.board[4] = river;
      this.street = "river";
    } else {
      return;
    }
    this.startBettingRound();
  }

  /** Advance action left (same direction as blinds). */
  private advanceAction() {
    const canBetList = this.seatsThatCanBet();
    if (canBetList.length === 0 || this.actionSeat === null) {
      this.actionSeat = null;
      return;
    }
    const canBet = new Set(canBetList);
    const start = this.actionSeat;
    for (let step = 1; step <= MAX_ONLINE_PLAYERS; step++) {
      const next = (start - step + MAX_ONLINE_PLAYERS) % MAX_ONLINE_PLAYERS;
      if (!canBet.has(next)) continue;
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
    this.recordHandResult(won, winners);
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
      this.recordHandResult(won, active);
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
    this.recordHandResult(won, winners);
  }

  private requireActor(connectionId: string): number {
    if (!this.bettingOpen || this.handOver) {
      throw new Error("Betting is closed");
    }
    const seat = this.seatIndexOf(connectionId);
    if (seat < 0) throw new Error("You are not seated");
    if (!this.seats[seat].inHand) throw new Error("Sitting out this hand");
    if (this.seats[seat].folded) throw new Error("You already folded");
    if (this.seats[seat].chips === 0) throw new Error("You are all-in");
    if (seat !== this.actionSeat) throw new Error("Not your turn");
    return seat;
  }
}
