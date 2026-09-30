/** Side-pot construction for multiway all-in pots. */

export type PotContribution = {
  seat: number;
  /** Total chips this seat put into the pot this hand. */
  amount: number;
  folded: boolean;
};

export type SidePot = {
  amount: number;
  /** Seats eligible to win this pot (contributed to this layer, not folded). */
  eligible: number[];
};

/**
 * Build main + side pots from per-seat contributions.
 * Folded players still build pot size but cannot win.
 */
export function buildSidePots(contributions: PotContribution[]): SidePot[] {
  const active = contributions
    .filter((c) => c.amount > 0)
    .map((c) => ({ ...c }));
  const pots: SidePot[] = [];

  while (active.length > 0) {
    const min = Math.min(...active.map((c) => c.amount));
    const amount = min * active.length;
    const eligible = active.filter((c) => !c.folded).map((c) => c.seat);
    pots.push({
      amount,
      // If everyone in the layer folded (shouldn't reach showdown), fall back.
      eligible: eligible.length > 0 ? eligible : active.map((c) => c.seat),
    });
    for (const c of active) c.amount -= min;
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].amount <= 0) active.splice(i, 1);
    }
  }

  return pots;
}

/** Split `amount` as evenly as possible; remainder chips go to earlier seats. */
export function splitPotAmount(
  amount: number,
  winnerSeats: number[],
): Map<number, number> {
  const out = new Map<number, number>();
  if (winnerSeats.length === 0 || amount <= 0) return out;
  const share = Math.floor(amount / winnerSeats.length);
  let remainder = amount - share * winnerSeats.length;
  for (const seat of winnerSeats) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    out.set(seat, (out.get(seat) ?? 0) + share + extra);
  }
  return out;
}
