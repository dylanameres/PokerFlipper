/** Side-pot construction for multiway all-in pots. */

export type PotContribution = {
  seat: number;
  /** Total chips this seat put into the pot this hand. */
  amount: number;
  folded: boolean;
  /** Live player with no chips behind; their total caps a pot layer. */
  allIn: boolean;
};

export type SidePot = {
  amount: number;
  /** Seats eligible to win this pot (contributed to this layer, not folded). */
  eligible: number[];
};

/**
 * Build main + side pots from per-seat contributions.
 *
 * A pot only splits at an all-in player's total: chips above it form a side
 * pot that player cannot win. Folded chips stay in whichever layers they
 * reach but never create a split. Without a live all-in this is one pot,
 * however uneven the bets are mid-round.
 */
export function buildSidePots(contributions: PotContribution[]): SidePot[] {
  const contribs = contributions.filter((c) => c.amount > 0);
  if (contribs.length === 0) return [];
  const top = Math.max(...contribs.map((c) => c.amount));
  const caps = [
    ...new Set(
      contribs
        .filter((c) => c.allIn && !c.folded && c.amount < top)
        .map((c) => c.amount),
    ),
    top,
  ].sort((a, b) => a - b);

  const pots: SidePot[] = [];
  let prev = 0;
  for (const cap of caps) {
    let amount = 0;
    for (const c of contribs) {
      amount += Math.max(0, Math.min(c.amount, cap) - prev);
    }
    const eligible = contribs
      .filter((c) => !c.folded && c.amount > prev)
      .map((c) => c.seat);
    const last = pots[pots.length - 1];
    if (last && sameSeats(last.eligible, eligible)) {
      last.amount += amount;
    } else if (amount > 0) {
      pots.push({
        amount,
        // Everyone in the layer folded (shouldn't reach showdown): fall back.
        eligible:
          eligible.length > 0
            ? eligible
            : contribs.filter((c) => c.amount > prev).map((c) => c.seat),
      });
    }
    prev = cap;
  }
  return pots;
}

function sameSeats(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/**
 * Chips of the largest contribution that nobody matched (an uncalled bet or
 * the excess of an all-in over every other stack). Returned to that seat
 * when betting closes rather than becoming a one-player side pot.
 */
export function uncalledExcess(
  contributions: PotContribution[],
): { seat: number; amount: number } | null {
  const sorted = contributions
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (sorted.length === 0 || sorted[0].folded) return null;
  const excess = sorted[0].amount - (sorted[1]?.amount ?? 0);
  return excess > 0 ? { seat: sorted[0].seat, amount: excess } : null;
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
