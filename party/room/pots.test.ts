import { describe, expect, it } from "vitest";
import {
  buildSidePots,
  splitPotAmount,
  uncalledExcess,
  type PotContribution,
} from "./pots";

const live = (seat: number, amount: number): PotContribution => ({
  seat,
  amount,
  folded: false,
  allIn: false,
});
const allIn = (seat: number, amount: number): PotContribution => ({
  seat,
  amount,
  folded: false,
  allIn: true,
});
const folded = (seat: number, amount: number): PotContribution => ({
  seat,
  amount,
  folded: true,
  allIn: false,
});

describe("buildSidePots", () => {
  it("builds main + side pot for a short all-in", () => {
    const pots = buildSidePots([allIn(0, 50), live(1, 100), live(2, 100)]);
    expect(pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 100, eligible: [1, 2] },
    ]);
  });

  it("excludes folded players from eligibility but keeps their chips", () => {
    const pots = buildSidePots([allIn(0, 50), live(1, 100), folded(2, 100)]);
    expect(pots).toEqual([
      { amount: 150, eligible: [0, 1] },
      { amount: 100, eligible: [1] },
    ]);
  });

  it("handles equal contributions as a single pot", () => {
    const pots = buildSidePots([live(0, 75), live(1, 75)]);
    expect(pots).toEqual([{ amount: 150, eligible: [0, 1] }]);
  });

  it("keeps posted blinds as one pot before anyone acts", () => {
    const pots = buildSidePots([live(0, 0), live(1, 25), live(2, 50)]);
    expect(pots).toEqual([{ amount: 75, eligible: [1, 2] }]);
  });

  it("keeps a bet and raise mid-round as one pot", () => {
    // UTG bets 100, SB calls 100, BB raises to 300 — nobody all-in.
    const pots = buildSidePots([live(0, 100), live(1, 100), live(2, 300)]);
    expect(pots).toEqual([{ amount: 500, eligible: [0, 1, 2] }]);
  });

  it("does not split when a player folds after putting chips in", () => {
    // Seat 0 calls 50 then folds to a raise; seats 1 and 2 go to 200.
    const pots = buildSidePots([folded(0, 50), live(1, 200), live(2, 200)]);
    expect(pots).toEqual([{ amount: 450, eligible: [1, 2] }]);
  });

  it("does not split for an all-in that everyone matched exactly", () => {
    const pots = buildSidePots([allIn(0, 100), live(1, 100), live(2, 100)]);
    expect(pots).toEqual([{ amount: 300, eligible: [0, 1, 2] }]);
  });

  it("builds one side pot per distinct all-in level", () => {
    const pots = buildSidePots([
      allIn(0, 50),
      allIn(1, 120),
      live(2, 300),
      live(3, 300),
    ]);
    expect(pots).toEqual([
      { amount: 200, eligible: [0, 1, 2, 3] },
      { amount: 210, eligible: [1, 2, 3] },
      { amount: 360, eligible: [2, 3] },
    ]);
  });

  it("merges players all-in for the same amount into one level", () => {
    const pots = buildSidePots([
      allIn(0, 80),
      allIn(1, 80),
      live(2, 200),
      live(3, 200),
    ]);
    expect(pots).toEqual([
      { amount: 320, eligible: [0, 1, 2, 3] },
      { amount: 240, eligible: [2, 3] },
    ]);
  });

  it("puts a folded player's chips into the layers they reach", () => {
    // Seat 3 put 100 in then folded; seat 0 is all-in for 60.
    const pots = buildSidePots([
      allIn(0, 60),
      live(1, 200),
      live(2, 200),
      folded(3, 100),
    ]);
    expect(pots).toEqual([
      { amount: 240, eligible: [0, 1, 2] },
      { amount: 320, eligible: [1, 2] },
    ]);
  });

  it("ignores all-in flags on folded seats", () => {
    const pots = buildSidePots([
      { seat: 0, amount: 40, folded: true, allIn: true },
      live(1, 100),
      live(2, 100),
    ]);
    expect(pots).toEqual([{ amount: 240, eligible: [1, 2] }]);
  });

  it("keeps the total equal to every chip contributed", () => {
    const contribs = [
      allIn(0, 35),
      folded(1, 90),
      allIn(2, 140),
      live(3, 400),
      live(4, 400),
      folded(5, 10),
    ];
    const total = contribs.reduce((n, c) => n + c.amount, 0);
    const pots = buildSidePots(contribs);
    expect(pots.reduce((n, p) => n + p.amount, 0)).toBe(total);
  });
});

describe("uncalledExcess", () => {
  it("returns the unmatched part of the biggest bet", () => {
    expect(uncalledExcess([allIn(0, 100), live(1, 500), folded(2, 200)])).toEqual(
      { seat: 1, amount: 300 },
    );
  });

  it("returns nothing when the top bet was matched", () => {
    expect(uncalledExcess([live(0, 200), live(1, 200), allIn(2, 50)])).toBeNull();
  });

  it("never refunds a folded seat", () => {
    expect(uncalledExcess([folded(0, 300), live(1, 100)])).toBeNull();
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
