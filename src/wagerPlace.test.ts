import { describe, expect, it } from "vitest";
import {
  wagerPlacement,
  wagerPresentation,
  wagerTowardCenter,
} from "./wagerPlace";

describe("wagerTowardCenter", () => {
  it("puts the hero's action above their cards", () => {
    for (const total of [2, 3, 6]) {
      const toward = wagerTowardCenter(0, total);
      expect(toward.y).toBeLessThan(-0.9);
      expect(Math.abs(toward.x)).toBeLessThan(0.05);
      expect(wagerPlacement(toward)).toBe("above");
    }
  });

  it("puts an across-the-table action below their cards", () => {
    const headsUp = wagerTowardCenter(1, 2);
    expect(headsUp.y).toBeGreaterThan(0.9);
    expect(Math.abs(headsUp.x)).toBeLessThan(0.05);
    expect(wagerPlacement(headsUp)).toBe("below");

    const sixMax = wagerTowardCenter(3, 6);
    expect(sixMax.y).toBeGreaterThan(0.9);
    expect(Math.abs(sixMax.x)).toBeLessThan(0.05);
    expect(wagerPlacement(sixMax)).toBe("below");
  });

  it("puts side seats beside their cards, toward the middle", () => {
    expect(wagerPlacement(wagerTowardCenter(1, 6))).toBe("right");
    expect(wagerPlacement(wagerTowardCenter(2, 6))).toBe("right");
    expect(wagerPlacement(wagerTowardCenter(4, 6))).toBe("left");
    expect(wagerPlacement(wagerTowardCenter(5, 6))).toBe("left");
  });
});

describe("wagerPresentation", () => {
  it("names bets, raises, and calls with the chips in front", () => {
    expect(wagerPresentation("bet", 100)).toEqual({
      kind: "bet",
      label: "Bet 100",
    });
    expect(wagerPresentation("raise", 1250)).toEqual({
      kind: "raise",
      label: "Raise 1,250",
    });
    expect(wagerPresentation("call", 50)).toEqual({
      kind: "call",
      label: "Call 50",
    });
  });

  it("shows a blind as chips until that seat acts", () => {
    expect(wagerPresentation(undefined, 25)).toEqual({
      kind: "chips",
      label: "25",
    });
    expect(wagerPresentation(undefined, 0)).toBeNull();
  });

  it("keeps a blind posted when the big blind checks", () => {
    expect(wagerPresentation("check", 50)).toEqual({
      kind: "check",
      label: "Check 50",
    });
    expect(wagerPresentation("check", 0)).toEqual({
      kind: "check",
      label: "Check",
    });
  });
});
