import {
  BIG_BLIND,
  EMOTE_COOLDOWN_MS,
  EMOTE_DURATION_MS,
  HOLE_COUNT,
  MAX_ONLINE_PLAYERS,
  MIN_BET,
  MIN_ONLINE_PLAYERS,
  ROOM_PROTOCOL,
  SMALL_BLIND,
  STARTING_CHIPS,
  isCardBackId,
  isEmoteId,
  sanitizePlayerName,
  type ClientMessage,
  type GameType,
  type PotPublic,
  type RoomView,
  type SeatBubbleId,
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
import {
  buildSidePots,
  splitPotAmount,
  uncalledExcess,
  type PotContribution,
} from "./pots";
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
  /** Host identity survives reconnects (connection ids change). */
  hostPlayerId: string | null = null;
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
  private emoteSeq = 0;
  private static readonly RUNOUT_PAUSE_MS = 900;

  constructor(private readonly notify: TableNotify) {}

  private holes(): number {
    return HOLE_COUNT[this.gameType];
  }

  ensureSeats() {
    if (!this.seatsReady) {
      this.seats = Array.from({ length: MAX_ONLINE_PLAYERS }, () =>
        this.freshSeat(),
      );
      this.seatsReady = true;
      return;
    }
    // Hot-upgrade older rooms that were created with fewer chairs.
    while (this.seats.length < MAX_ONLINE_PLAYERS) {
      this.seats.push(this.freshSeat());
    }
  }

  private freshSeat(): RoomSeat {
    return {
      connectionId: null,
      playerId: null,
      name: null,
      cardBack: null,
      emote: null,
      holes: emptyHoles(this.holes()),
      chips: STARTING_CHIPS,
      betStreet: 0,
      streetAction: null,
      contributed: 0,
      folded: false,
      acted: false,
      inHand: false,
    };
  }

  /** Connected players (live sockets). */
  seatedCount(): number {
    let n = 0;
    for (const s of this.seats) {
      if (s.connectionId !== null) n += 1;
    }
    return n;
  }

  /** Occupied chairs including disconnected reserves. */
  occupiedCount(): number {
    let n = 0;
    for (const s of this.seats) {
      if (s.playerId !== null) n += 1;
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

  private isHostConnection(connectionId: string): boolean {
    const seat = this.seats[this.seatIndexOf(connectionId)];
    return Boolean(
      seat?.playerId && this.hostPlayerId && seat.playerId === this.hostPlayerId,
    );
  }

  /**
   * Seat or reclaim by browser `playerId`.
   * Reclaim keeps chips / hand state; new joins sit out a live hand.
   */
  seatPlayer(
    connectionId: string,
    playerId: string,
  ): { ok: true; seat: number; reclaimed: boolean } | { ok: false; message: string } {
    this.ensureSeats();
    const pid = playerId.trim();
    if (!pid) {
      return { ok: false, message: "Missing player id" };
    }

    const byConn = this.seatIndexOf(connectionId);
    if (byConn >= 0) {
      this.seats[byConn].playerId = pid;
      if (!this.hostPlayerId) this.hostPlayerId = pid;
      return { ok: true, seat: byConn, reclaimed: true };
    }

    const reclaim = this.seats.findIndex((s) => s.playerId === pid);
    if (reclaim >= 0) {
      this.seats[reclaim].connectionId = connectionId;
      if (!this.hostPlayerId) this.hostPlayerId = pid;
      return { ok: true, seat: reclaim, reclaimed: true };
    }

    let seatIndex = this.seats.findIndex((s) => s.playerId === null);
    if (seatIndex === -1) {
      // Recycle a disconnected reserve that is done for this hand.
      seatIndex = this.seats.findIndex(
        (s) =>
          s.playerId !== null &&
          s.connectionId === null &&
          (!s.inHand ||
            s.folded ||
            this.handOver ||
            this.street === "predeal"),
      );
    }
    if (seatIndex === -1) {
      return {
        ok: false,
        message: `Room is full (${MAX_ONLINE_PLAYERS} players).`,
      };
    }

    const seat = this.seats[seatIndex];
    seat.playerId = pid;
    seat.connectionId = connectionId;
    seat.name = null;
    seat.cardBack = null;
    seat.emote = null;
    seat.holes = emptyHoles(this.holes());
    seat.chips = STARTING_CHIPS;
    seat.betStreet = 0;
    seat.streetAction = null;
    seat.contributed = 0;
    seat.folded = false;
    seat.acted = false;
    seat.inHand = false;
    if (!this.hostPlayerId) this.hostPlayerId = pid;
    return { ok: true, seat: seatIndex, reclaimed: false };
  }

  /**
   * Drop a live connection but keep the seat reserved for `playerId` reclaim.
   * Players who can still bet are auto-folded so the hand cannot stall;
   * all-in players stay in for showdown.
   */
  unseatPlayer(connectionId: string) {
    this.ensureSeats();
    const seatIndex = this.seatIndexOf(connectionId);
    if (seatIndex < 0) return;

    const seat = this.seats[seatIndex];
    const needsFold =
      this.handInProgress() &&
      seat.inHand &&
      !seat.folded &&
      seat.chips > 0;

    seat.connectionId = null;

    if (seat.playerId && seat.playerId === this.hostPlayerId) {
      const next = this.seats.find((s) => s.connectionId && s.playerId);
      this.hostPlayerId = next?.playerId ?? this.hostPlayerId;
    }

    if (needsFold) {
      seat.folded = true;
      seat.acted = true;
      seat.holes = emptyHoles(this.holes());
      if (this.afterAction()) {
        // Caller broadcasts; runout notifies itself.
      }
    }
  }

  handle(msg: ClientMessage, connectionId: string) {
    this.ensureSeats();
    const isHost = this.isHostConnection(connectionId);

    switch (msg.type) {
      case "hello": {
        if (msg.playerId) {
          const claimed = this.seatPlayer(connectionId, msg.playerId);
          if (!claimed.ok) throw new Error(claimed.message);
        }
        if (this.isHostConnection(connectionId) && this.street === "predeal") {
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
        // Rebuy broke connected players.
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
          seat.streetAction = null;
          seat.contributed = 0;
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
        s.streetAction = toCall > 0 ? "call" : "check";
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
        const facing = this.currentBet;
        this.putChips(s, add);
        const opened = s.betStreet > facing;
        s.streetAction = opened ? (facing > 0 ? "raise" : "bet") : "call";
        this.currentBet = s.betStreet;
        s.acted = true;
        for (let i = 0; i < this.seats.length; i++) {
          const other = this.seats[i];
          if (i === seat || other.folded || !other.inHand) continue;
          if (other.chips === 0) {
            other.acted = true;
            continue;
          }
          other.acted = false;
          if (opened && other.streetAction === "check") other.streetAction = null;
        }
        if (this.afterAction()) this.notify();
        return;
      }
      case "set_name": {
        const seat = this.seatIndexOf(connectionId);
        if (seat < 0) throw new Error("Not seated");
        const name = sanitizePlayerName(msg.name);
        if (!name) throw new Error("Name must be 1–120 characters");
        this.seats[seat].name = name;
        this.notify();
        return;
      }
      case "set_card_back": {
        const seat = this.seatIndexOf(connectionId);
        if (seat < 0) throw new Error("Not seated");
        if (!isCardBackId(msg.cardBack)) throw new Error("Invalid card back");
        this.seats[seat].cardBack = msg.cardBack;
        this.notify();
        return;
      }
      case "emote": {
        const seat = this.seatIndexOf(connectionId);
        if (seat < 0) throw new Error("Not seated");
        if (!isEmoteId(msg.emote)) throw new Error("Invalid emote");
        const s = this.seats[seat];
        if (s.emote) {
          const age = Date.now() - s.emote.at;
          if (age < EMOTE_COOLDOWN_MS) return;
          // Player emotes never cover a live All in bubble.
          if (s.emote.id === "all_in" && age < EMOTE_DURATION_MS) return;
        }
        this.showBubble(s, msg.emote);
        this.notify();
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
    const seated = this.seatedCount();
    const tableLive = this.street !== "predeal";

    let yourHoles: WireCard[] = emptyHoles(n);
    if (yourSeat >= 0) {
      yourHoles = this.seats[yourSeat].holes.slice();
    }

    // Deprecated HU helpers — only when exactly one other *in-hand* opponent.
    let opponentHidden: boolean[] | undefined;
    let opponentHoles: WireCard[] | null | undefined;
    const othersInHand: number[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      if (i === yourSeat) continue;
      if (this.seats[i].playerId && this.seats[i].inHand) {
        othersInHand.push(i);
      }
    }
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

    const connected = seated;
    const occupied = this.occupiedCount();
    const waiting = connected < MIN_ONLINE_PLAYERS;
    const youHost = this.isHostConnection(connectionId);
    let status: string;
    if (waiting) {
      status = roomId
        ? `Room ${roomId} — ${connected}/${MIN_ONLINE_PLAYERS} players…`
        : `Waiting for players (${connected}/${MIN_ONLINE_PLAYERS})…`;
    } else if (this.street === "predeal") {
      status = youHost
        ? `${connected} players ready. Deal hands when you want.`
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
          yourSeat === w
            ? "You win the pot."
            : `${this.seatLabel(w)} wins the pot.`;
      } else {
        status = "Hand over.";
      }
    } else if (this.bettingOpen && this.actionSeat !== null) {
      status =
        yourSeat === this.actionSeat
          ? toCall > 0
            ? `Your turn — ${toCall} to call.`
            : "Your turn — check or bet."
          : `Waiting for ${this.seatLabel(this.actionSeat)}…`;
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
      const occupiedSeat = s.playerId !== null;
      const connectedSeat = s.connectionId !== null;
      const pub: SeatPublic = {
        filled: occupiedSeat,
        connected: connectedSeat,
        chips: s.chips,
        bet: s.betStreet,
        ...(s.streetAction ? { action: s.streetAction } : {}),
        folded: s.folded,
        inHand: occupiedSeat ? s.inHand : false,
        // Blind/button markers use deal-time seats; never re-derive after leaves.
        isButton: tableLive && occupiedSeat && i === this.buttonSeat,
        isSmallBlind: tableLive && occupiedSeat && i === sb,
        isBigBlind: tableLive && occupiedSeat && i === bb,
      };
      if (occupiedSeat && s.name) pub.name = s.name;
      if (occupiedSeat) pub.cardBack = s.cardBack ?? "blue";
      if (occupiedSeat && s.emote && Date.now() - s.emote.at < EMOTE_DURATION_MS) {
        pub.emote = { id: s.emote.id, seq: s.emote.seq };
      }
      if (!occupiedSeat || !s.inHand) return pub;

      // Own holes live in `yourHoles` only — avoid duplicating on the wire.
      if (i === yourSeat) return pub;

      if (doReveal) {
        pub.holes = s.holes.slice();
        pub.holeHidden = Array.from({ length: n }, () => false);
      } else if (s.holes.some((c) => c !== null)) {
        pub.holeHidden = s.holes.map((c) => c !== null);
      }
      return pub;
    });

    const potLayers = this.currentPotLayers();

    return {
      type: "state",
      protocol: ROOM_PROTOCOL,
      roomId,
      gameType: this.gameType,
      street: this.street,
      yourSeat: yourSeat >= 0 ? yourSeat : null,
      youAreHost: youHost,
      seats,
      maxSeats: MAX_ONLINE_PLAYERS,
      seatedCount: occupied,
      board: this.board.slice(),
      yourHoles,
      opponentHidden,
      opponentHoles,
      revealed: doReveal,
      status,
      pot: this.pot,
      pots: potLayers.length > 1 ? potLayers : undefined,
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
      seat.streetAction = null;
      seat.contributed = 0;
      seat.folded = false;
      seat.acted = false;
      seat.inHand = false;
    }
  }

  /**
   * Next filled seat to the left (action / blinds / button go this way).
   * Matches the table UI: increasing seat index is left of the hero.
   */
  private seatLeftOfFilled(seat: number): number {
    for (let step = 1; step <= MAX_ONLINE_PLAYERS; step++) {
      const next = (seat + step) % MAX_ONLINE_PLAYERS;
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

  /** Live status / waiting text — prefers the player's display name. */
  private seatLabel(seat: number): string {
    const name = this.seats[seat]?.name?.trim();
    return name || `P${seat + 1}`;
  }

  /**
   * Stable Pn tokens for history so clients can personalize + color wins/losses
   * even after a rename.
   */
  private historySeatLabel(seat: number): string {
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
      result = `${this.historySeatLabel(winners[0])} wins ${pot}`;
    } else {
      result = `Pot ${pot}`;
    }
    this.pushHistory(`#${this.handsDealt} ${result}`);
  }

  private recordSidePotResults(
    awards: { seat: number; amount: number }[],
    totalPot: number,
  ) {
    if (awards.length === 0) {
      this.recordHandResult(totalPot, []);
      return;
    }
    // Collapse per-seat totals for history.
    const bySeat = new Map<number, number>();
    for (const a of awards) {
      bySeat.set(a.seat, (bySeat.get(a.seat) ?? 0) + a.amount);
    }
    const parts = [...bySeat.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seat, amount]) => `${this.historySeatLabel(seat)} wins ${amount}`);
    this.pushHistory(`#${this.handsDealt} ${parts.join(" · ")}`);
  }

  /** Live pot layers from contributions (for UI when side pots exist). */
  private currentPotLayers(): PotPublic[] {
    return buildSidePots(this.potContributions());
  }

  private potContributions(): PotContribution[] {
    return this.seats.map((s, seat) => {
      const folded = s.folded || !s.inHand;
      return {
        seat,
        amount: s.contributed,
        folded,
        allIn: !folded && s.chips === 0 && s.contributed > 0,
      };
    });
  }

  /** Hand back the part of the biggest bet nobody matched. */
  private returnUncalledBet() {
    const uncalled = uncalledExcess(this.potContributions());
    if (!uncalled) return;
    const s = this.seats[uncalled.seat];
    const fromStreet = Math.min(uncalled.amount, s.betStreet);
    s.contributed -= uncalled.amount;
    s.betStreet -= fromStreet;
    s.chips += uncalled.amount;
    this.pot -= uncalled.amount;
    if (this.currentBet > s.betStreet) {
      this.currentBet = Math.max(0, ...this.seats.map((x) => x.betStreet));
    }
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

  /** Contenders still in the hand (may be disconnected if all-in). */
  private activeSeats(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (s.inHand && !s.folded) out.push(i);
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
    seat.contributed += n;
    this.pot += n;
    if (n > 0 && seat.chips === 0) this.showBubble(seat, "all_in");
    return n;
  }

  /**
   * Put a bubble over a seat and clear it after EMOTE_DURATION_MS.
   * Caller broadcasts the new bubble; the clear broadcasts itself.
   */
  private showBubble(seat: RoomSeat, id: SeatBubbleId) {
    const seq = ++this.emoteSeq;
    seat.emote = { id, seq, at: Date.now() };
    setTimeout(() => {
      if (seat.emote?.seq !== seq) return;
      seat.emote = null;
      this.notify();
    }, EMOTE_DURATION_MS);
  }

  private seatsThatCanBet(): number[] {
    return this.activeSeats().filter((i) => this.seats[i].chips > 0);
  }

  /** First seat that can bet, walking left from `from` (exclusive). */
  private firstActiveLeftOf(from: number): number | null {
    const canBet = new Set(this.seatsThatCanBet());
    for (let step = 1; step <= MAX_ONLINE_PLAYERS; step++) {
      const seat = (from + step) % MAX_ONLINE_PLAYERS;
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
      seat.streetAction = null;
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
    this.returnUncalledBet();
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

  /** Advance action left (same direction as blinds / UI). */
  private advanceAction() {
    const canBetList = this.seatsThatCanBet();
    if (canBetList.length === 0 || this.actionSeat === null) {
      this.actionSeat = null;
      return;
    }
    const canBet = new Set(canBetList);
    const start = this.actionSeat;
    for (let step = 1; step <= MAX_ONLINE_PLAYERS; step++) {
      const next = (start + step) % MAX_ONLINE_PLAYERS;
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
    const totalPot = this.pot;
    if (active.length === 0) {
      this.winnerSeats = [];
      this.pot = 0;
      return;
    }
    if (active.length === 1) {
      this.winnerSeats = active;
      this.seats[active[0]].chips += totalPot;
      this.pot = 0;
      this.recordHandResult(totalPot, active);
      return;
    }

    const board = this.board.filter((c): c is number => c !== null);
    const scoreOf = (seat: number) => {
      const holes = this.seats[seat].holes.filter(
        (c): c is number => c !== null,
      );
      return scoreHand(this.gameType, holes, board);
    };

    const pots = buildSidePots(this.potContributions());

    const winnerSet = new Set<number>();
    const awards: { seat: number; amount: number }[] = [];
    for (const layer of pots) {
      if (layer.amount <= 0 || layer.eligible.length === 0) continue;
      let winners = layer.eligible;
      if (winners.length > 1) {
        const scores = winners.map(scoreOf);
        const best = Math.max(...scores);
        winners = winners.filter((_, idx) => scores[idx] === best);
      }
      const shares = splitPotAmount(layer.amount, winners);
      for (const [seat, amount] of shares) {
        this.seats[seat].chips += amount;
        winnerSet.add(seat);
        awards.push({ seat, amount });
      }
    }

    this.winnerSeats = [...winnerSet].sort((a, b) => a - b);
    this.pot = 0;
    this.recordSidePotResults(awards, totalPot);
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
