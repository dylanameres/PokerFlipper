/** Shared client ↔ room server protocol. */

export type GameType = "holdem" | "omaha";
export type Street = "predeal" | "holes" | "flop" | "turn" | "river";

/** Wire format for a card: 0–51, or null empty. */
export type WireCard = number | null;

export const STARTING_CHIPS = 1000;
export const SMALL_BLIND = 25;
export const BIG_BLIND = 50;
/** Minimum open / raise size (matches the big blind). */
export const MIN_BET = BIG_BLIND;

export type ClientMessage =
  | { type: "hello"; gameType: GameType }
  | { type: "deal_hands" }
  | { type: "deal_flop" }
  | { type: "deal_turn" }
  | { type: "deal_river" }
  | { type: "new_round" }
  | { type: "fold" }
  | { type: "call" }
  | { type: "bet"; amount: number };

export interface SeatPublic {
  filled: boolean;
  connected: boolean;
  chips: number;
  bet: number;
  folded: boolean;
  /** Heads-up dealer / small blind. */
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
}

/**
 * Personalized view for one connection.
 * Opponent hole cards are "hidden" until showdown — never sent as real values early.
 */
export interface RoomView {
  type: "state";
  roomId: string;
  gameType: GameType;
  street: Street;
  yourSeat: number | null;
  youAreHost: boolean;
  seats: SeatPublic[];
  board: WireCard[];
  yourHoles: WireCard[];
  /** Same length as hole count; true = face-down card present. */
  opponentHidden: boolean[];
  /** Filled only after showdown (river dealt). */
  opponentHoles: WireCard[] | null;
  revealed: boolean;
  status: string;
  pot: number;
  smallBlind: number;
  bigBlind: number;
  buttonSeat: number | null;
  toCall: number;
  minBet: number;
  maxBet: number;
  canAct: boolean;
  /** Facing no wager → check; else call. */
  canCheck: boolean;
  canBet: boolean;
  bettingOpen: boolean;
  /** Betting finished; host may deal the next street (or hand is over). */
  bettingComplete: boolean;
  handOver: boolean;
  /** Empty when no winner yet; one seat on win; both on chop. */
  winnerSeats: number[];
  actionSeat: number | null;
}

export type ServerMessage = RoomView | { type: "error"; message: string };

export const HOLE_COUNT: Record<GameType, number> = {
  holdem: 2,
  omaha: 4,
};

export const MAX_ONLINE_PLAYERS = 2;
