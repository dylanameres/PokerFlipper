import { describe, expect, it } from "vitest";
import { buildSidePots, splitPotAmount } from "./pots";

describe("buildSidePots", () => {
  it("builds main + side pot for a short all-in", () => {
    // A all-in 50, B and C each put 100.
    const pots = buildSidePots([
      { seat: 0, amount: 50, folded: false },
      { seat: 1, amount: 100, folded: false },
      { seat: 2, amount: 100, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 100, eligible: [1, 2] },
    ]);
  });

  it("excludes folded players from eligibility but keeps their chips", () => {
    const pots = buildSidePots([
      { seat: 0, amount: 50, folded: false },
      { seat: 1, amount: 100, folded: false },
      { seat: 2, amount: 100, folded: true },
    ]);
    expect(pots).toEqual([
      { amount: 150, eligible: [0, 1] },
      { amount: 100, eligible: [1] },
    ]);
  });

  it("handles equal contributions as a single pot", () => {
    const pots = buildSidePots([
      { seat: 0, amount: 75, folded: false },
      { seat: 1, amount: 75, folded: false },
    ]);
    expect(pots).toEqual([{ amount: 150, eligible: [0, 1] }]);
  });
});

describe("splitPotAmount", () => {
  it("splits with remainder to earlier winners", () => {
    const shares = splitPotAmount(100, [2, 0, 1]);
    expect(shares.get(2)).toBe(34);
    expect(shares.get(0)).toBe(33);
    expect(shares.get(1)).toBe(33);
  });
});
