/** Shared client ↔ PartyKit room protocol. */

export type GameType = "holdem" | "omaha";
export type Street = "predeal" | "holes" | "flop" | "turn" | "river";

/** Wire format for a card: 0–51, or null empty. */
export type WireCard = number | null;

export type ClientMessage =
  | { type: "hello"; gameType: GameType }
  | { type: "deal_hands" }
  | { type: "deal_flop" }
  | { type: "deal_turn" }
  | { type: "deal_river" }
  | { type: "new_round" };

export interface SeatPublic {
  filled: boolean;
  connected: boolean;
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
}

export type ServerMessage = RoomView | { type: "error"; message: string };

export const HOLE_COUNT: Record<GameType, number> = {
  holdem: 2,
  omaha: 4,
};

export const MAX_ONLINE_PLAYERS = 2;
