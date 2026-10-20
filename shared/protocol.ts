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

/**
 * Bump when the room server wire format changes in a breaking/feature way.
 * 6 = side pots + browser playerId seat reclaim.
 * 7 = per-seat display names (set_name).
 * 8 = per-seat card backs (set_card_back).
 * 9 = more card backs (felt, noir, midnight, sunset).
 * 10 = zomba card back.
 * 11 = inferno card back replaces felt.
 * 12 = treasure card back replaces inferno.
 * 13 = seat emotes (emote).
 * 14 = nice_hand emote replaces all_in; server raises all_in bubbles.
 * 15 = tilt + wow emotes.
 */
export const ROOM_PROTOCOL = 15;

/** Face-down card back designs shared by client + room server. */
export const CARD_BACK_IDS = [
  "blue",
  "red",
  "arcane",
  "rainbow",
  "treasure",
  "noir",
  "midnight",
  "sunset",
  "zomba",
] as const;

export type CardBackId = (typeof CARD_BACK_IDS)[number];

export function isCardBackId(v: unknown): v is CardBackId {
  return (CARD_BACK_IDS as readonly unknown[]).includes(v);
}

/** Quick table emotes shown as a chat bubble over the sender's seat. */
export const EMOTE_IDS = [
  "gg",
  "haha",
  "ship_it",
  "nice_hand",
  "tilt",
  "wow",
] as const;

export type EmoteId = (typeof EMOTE_IDS)[number];

/** Seat bubbles: player emotes plus ones only the room server raises. */
export type SeatBubbleId = EmoteId | "all_in";

export const EMOTE_LABELS: Record<SeatBubbleId, string> = {
  gg: "GG",
  haha: "Haha",
  ship_it: "Ship it",
  nice_hand: "Nice Hand",
  tilt: "Tilt",
  wow: "Wow",
  all_in: "All in",
};

/** How long an emote bubble stays up. */
export const EMOTE_DURATION_MS = 3500;
/** Minimum gap between emotes from one seat (anti-spam). */
export const EMOTE_COOLDOWN_MS = 750;

export function isEmoteId(v: unknown): v is EmoteId {
  return (EMOTE_IDS as readonly unknown[]).includes(v);
}

export function isSeatBubbleId(v: unknown): v is SeatBubbleId {
  return v === "all_in" || isEmoteId(v);
}

/** Max seats in an online room (Hold'em-friendly). */
export const MAX_ONLINE_PLAYERS = 6;
/** Host may deal once this many players are seated. */
export const MIN_ONLINE_PLAYERS = 2;

/** Max length for an online display name (after trim). */
export const MAX_PLAYER_NAME_LENGTH = 120;

/**
 * Normalize a player display name for the wire.
 * Returns null when empty / whitespace-only after cleanup.
 */
export function sanitizePlayerName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PLAYER_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

export type ClientMessage =
  | { type: "hello"; gameType: GameType; playerId?: string }
  | { type: "deal_hands" }
  | { type: "deal_flop" }
  | { type: "deal_turn" }
  | { type: "deal_river" }
  | { type: "new_round" }
  | { type: "fold" }
  | { type: "call" }
  | { type: "bet"; amount: number }
  | { type: "set_name"; name: string }
  | { type: "set_card_back"; cardBack: CardBackId }
  | { type: "emote"; emote: EmoteId };

/** Active emote bubble on a seat. `seq` changes on every new emote. */
export interface SeatEmote {
  id: SeatBubbleId;
  seq: number;
}

export interface SeatPublic {
  filled: boolean;
  connected: boolean;
  /** Optional display name (max 120). Absent/empty → clients fall back to P{n}. */
  name?: string;
  /** Face-down hole-card back for this seat (default blue). */
  cardBack?: CardBackId;
  /** Present while this seat's emote bubble is up. */
  emote?: SeatEmote;
  chips: number;
  bet: number;
  folded: boolean;
  /**
   * True when this seat was dealt into the current hand.
   * False for empty chairs and players who joined mid-hand (sitting out).
   */
  inHand?: boolean;
  /** Dealer button (heads-up: also the big blind). */
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  /**
   * For seats that aren't you: true per hole slot when a face-down card is present.
   * Empty / unused seats omit this.
   */
  holeHidden?: boolean[];
  /**
   * Hole cards revealed at showdown (or your own seat is always in `yourHoles`).
   * Null/omitted while hidden.
   */
  holes?: WireCard[] | null;
}

/** One pot layer at showdown (main or side). */
export interface PotPublic {
  amount: number;
  /** Seat indices eligible to win this layer. */
  eligible: number[];
}

/**
 * Personalized view for one connection.
 * Other players' hole cards stay hidden until showdown.
 */
export interface RoomView {
  type: "state";
  /** Present on current Workers builds; missing means an outdated deploy. */
  protocol?: number;
  roomId: string;
  gameType: GameType;
  street: Street;
  yourSeat: number | null;
  youAreHost: boolean;
  seats: SeatPublic[];
  /** Table capacity (always MAX_ONLINE_PLAYERS on current servers). */
  maxSeats?: number;
  /** How many seats currently have a player (including disconnected reserves). */
  seatedCount?: number;
  board: WireCard[];
  yourHoles: WireCard[];
  /**
   * @deprecated protocol &lt; 5 HU helper — prefer `seats[i].holeHidden`.
   * Still filled when exactly one other player is seated.
   */
  opponentHidden?: boolean[];
  /**
   * @deprecated protocol &lt; 5 HU helper — prefer `seats[i].holes` at reveal.
   */
  opponentHoles?: WireCard[] | null;
  revealed: boolean;
  status: string;
  pot: number;
  /** Side-pot breakdown when an all-in created layers (omitted when single pot). */
  pots?: PotPublic[];
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
  /** Empty when no winner yet; one or more seats on win/chop. */
  winnerSeats: number[];
  actionSeat: number | null;
  /** Completed-hand summaries (newest last): winner and pot. */
  history: string[];
}

export type ServerMessage = RoomView | { type: "error"; message: string };

export const HOLE_COUNT: Record<GameType, number> = {
  holdem: 2,
  omaha: 4,
};
