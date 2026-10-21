import type {
  CardBackId,
  SeatBubbleId,
  StreetAction,
  WireCard,
} from "../../shared/protocol";

/** Internal seat state for the room engine (not sent on the wire as-is). */
export type RoomSeat = {
  connectionId: string | null;
  /** Stable browser identity for seat reclaim across reconnects. */
  playerId: string | null;
  /** Optional display name; null means fall back to P{n}. */
  name: string | null;
  /** Hole-card back design; null means default blue. */
  cardBack: CardBackId | null;
  /** Current emote bubble; `at` is the server time it was sent. */
  emote: { id: SeatBubbleId; seq: number; at: number } | null;
  holes: WireCard[];
  chips: number;
  betStreet: number;
  /** Last voluntary action this street; null for blinds and players yet to act. */
  streetAction: StreetAction | null;
  /** Total chips committed to the pot this hand (all streets). */
  contributed: number;
  folded: boolean;
  acted: boolean;
  /** Dealt into the current hand (false for empty seats and late joiners). */
  inHand: boolean;
};

export type RoomConnection = { id: string };
