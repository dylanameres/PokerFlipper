import type { WireCard } from "../../shared/protocol";

/** Internal seat state for the room engine (not sent on the wire as-is). */
export type RoomSeat = {
  connectionId: string | null;
  holes: WireCard[];
  chips: number;
  betStreet: number;
  folded: boolean;
  acted: boolean;
};

export type RoomConnection = { id: string };
