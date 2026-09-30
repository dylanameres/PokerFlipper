import type { WireCard } from "../../shared/protocol";

/** Internal seat state for the room engine (not sent on the wire as-is). */
export type RoomSeat = {
  connectionId: string | null;
  /** Stable browser identity for seat reclaim across reconnects. */
  playerId: string | null;
  holes: WireCard[];
  chips: number;
  betStreet: number;
  /** Total chips committed to the pot this hand (all streets). */
  contributed: number;
  folded: boolean;
  acted: boolean;
  /** Dealt into the current hand (false for empty seats and late joiners). */
  inHand: boolean;
};

export type RoomConnection = { id: string };
