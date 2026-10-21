import type { StreetAction } from "../shared/protocol";

/** How a seat's current street action is drawn in front of their cards. */
export type WagerKind = "bet" | "raise" | "call" | "check" | "chips";

export type WagerPresentation = {
  kind: WagerKind;
  label: string;
};

/**
 * Screen-space unit vector from a seat toward the middle of the felt.
 * +y points down, matching CSS. Layout index 0 is the hero at the bottom,
 * so their vector points up — the wager sits above their cards. The seat
 * opposite them points down, onto the table below their cards.
 */
export function wagerTowardCenter(
  layoutIndex: number,
  total: number,
): { x: number; y: number } {
  if (total <= 0) return { x: 0, y: -1 };
  const angle = Math.PI / 2 + (2 * Math.PI * layoutIndex) / total;
  const x = -Math.cos(angle);
  const y = -Math.sin(angle);
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Which edge of the cards the plaque hugs, on the side facing the pot. */
export type WagerPlacement = "above" | "below" | "left" | "right";

/**
 * Hero (bottom) is above their cards. The seat across is below theirs.
 * Seats on the sides sit beside the cards, toward the middle, so a wide
 * plaque stays off the board.
 */
export function wagerPlacement(toward: { x: number; y: number }): WagerPlacement {
  if (Math.abs(toward.x) >= Math.abs(toward.y)) {
    return toward.x >= 0 ? "right" : "left";
  }
  return toward.y >= 0 ? "below" : "above";
}

function formatAmount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Label for the chips and action sitting in front of a seat.
 * Blinds (chips out, no voluntary action yet) are the amount alone.
 * A check that closes over a blind keeps that amount so the chips stay visible.
 */
export function wagerPresentation(
  action: StreetAction | undefined,
  bet: number,
): WagerPresentation | null {
  const amount = formatAmount(bet);
  if (action === "bet" && bet > 0) return { kind: "bet", label: `Bet ${amount}` };
  if (action === "raise" && bet > 0) {
    return { kind: "raise", label: `Raise ${amount}` };
  }
  if (action === "call" && bet > 0) return { kind: "call", label: `Call ${amount}` };
  if (action === "check") {
    return {
      kind: "check",
      label: bet > 0 ? `Check ${amount}` : "Check",
    };
  }
  if (bet > 0) return { kind: "chips", label: amount };
  return null;
}
