export type GameType = "holdem" | "omaha";

export const HOLE_COUNT: Record<GameType, number> = {
  holdem: 2,
  omaha: 4,
};

/** Practical seat limits so the deck never runs short. */
export const MAX_PLAYERS: Record<GameType, number> = {
  holdem: 9,
  omaha: 6,
};

export const MIN_PLAYERS = 2;

export function gameLabel(type: GameType): string {
  return type === "holdem" ? "Hold'em" : "Omaha";
}
