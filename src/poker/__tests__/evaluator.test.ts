import { describe, expect, it } from "vitest";
import { parseCard } from "../cards";
import {
  categoryOf,
  evaluate5,
  evaluateBest,
  HandCategory,
} from "../evaluator";

function hand(...cards: string[]) {
  return cards.map(parseCard);
}

describe("evaluate5 categories", () => {
  it("detects a royal/straight flush", () => {
    const s = evaluate5(hand("As", "Ks", "Qs", "Js", "Ts"));
    expect(categoryOf(s)).toBe(HandCategory.StraightFlush);
  });

  it("detects the wheel straight flush (A-2-3-4-5)", () => {
    const s = evaluate5(hand("As", "2s", "3s", "4s", "5s"));
    expect(categoryOf(s)).toBe(HandCategory.StraightFlush);
  });

  it("detects four of a kind", () => {
    const s = evaluate5(hand("9s", "9h", "9d", "9c", "2s"));
    expect(categoryOf(s)).toBe(HandCategory.FourOfAKind);
  });

  it("detects a full house", () => {
    const s = evaluate5(hand("Ks", "Kh", "Kd", "2c", "2s"));
    expect(categoryOf(s)).toBe(HandCategory.FullHouse);
  });

  it("detects a flush", () => {
    const s = evaluate5(hand("As", "9s", "7s", "4s", "2s"));
    expect(categoryOf(s)).toBe(HandCategory.Flush);
  });

  it("detects a straight", () => {
    const s = evaluate5(hand("9s", "8h", "7d", "6c", "5s"));
    expect(categoryOf(s)).toBe(HandCategory.Straight);
  });

  it("detects the wheel straight (A-2-3-4-5)", () => {
    const s = evaluate5(hand("As", "2h", "3d", "4c", "5s"));
    expect(categoryOf(s)).toBe(HandCategory.Straight);
  });

  it("detects three of a kind", () => {
    const s = evaluate5(hand("Qs", "Qh", "Qd", "7c", "2s"));
    expect(categoryOf(s)).toBe(HandCategory.ThreeOfAKind);
  });

  it("detects two pair", () => {
    const s = evaluate5(hand("Js", "Jh", "4d", "4c", "2s"));
    expect(categoryOf(s)).toBe(HandCategory.TwoPair);
  });

  it("detects one pair", () => {
    const s = evaluate5(hand("Ts", "Th", "8d", "5c", "2s"));
    expect(categoryOf(s)).toBe(HandCategory.Pair);
  });

  it("detects high card", () => {
    const s = evaluate5(hand("As", "Jh", "8d", "5c", "2s"));
    expect(categoryOf(s)).toBe(HandCategory.HighCard);
  });
});

describe("hand ordering", () => {
  it("ranks categories correctly", () => {
    const highCard = evaluate5(hand("As", "Jh", "8d", "5c", "2s"));
    const pair = evaluate5(hand("2s", "2h", "8d", "5c", "3s"));
    const twoPair = evaluate5(hand("2s", "2h", "3d", "3c", "5s"));
    const trips = evaluate5(hand("2s", "2h", "2d", "5c", "8s"));
    const straight = evaluate5(hand("9s", "8h", "7d", "6c", "5s"));
    const flush = evaluate5(hand("As", "9s", "7s", "4s", "2s"));
    const fullHouse = evaluate5(hand("Ks", "Kh", "Kd", "2c", "2s"));
    const quads = evaluate5(hand("9s", "9h", "9d", "9c", "2s"));
    const straightFlush = evaluate5(hand("9s", "8s", "7s", "6s", "5s"));

    const ordered = [
      highCard,
      pair,
      twoPair,
      trips,
      straight,
      flush,
      fullHouse,
      quads,
      straightFlush,
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]).toBeGreaterThan(ordered[i - 1]);
    }
  });

  it("uses kickers to break ties", () => {
    const aceKicker = evaluate5(hand("Ks", "Kh", "Ad", "7c", "2s"));
    const queenKicker = evaluate5(hand("Ks", "Kh", "Qd", "7c", "2s"));
    expect(aceKicker).toBeGreaterThan(queenKicker);
  });

  it("ranks a higher flush above a lower flush", () => {
    const aceFlush = evaluate5(hand("As", "9s", "7s", "4s", "2s"));
    const kingFlush = evaluate5(hand("Ks", "9s", "7s", "4s", "2s"));
    expect(aceFlush).toBeGreaterThan(kingFlush);
  });
});

describe("evaluateBest with 7 cards", () => {
  it("finds the best five-card hand", () => {
    // Board + hole makes a flush.
    const s = evaluateBest(hand("As", "Ks", "Qs", "2h", "3d", "9s", "5s"));
    expect(categoryOf(s)).toBe(HandCategory.Flush);
  });

  it("finds a full house across 7 cards", () => {
    const s = evaluateBest(hand("Ks", "Kh", "Kd", "2c", "2s", "7h", "9d"));
    expect(categoryOf(s)).toBe(HandCategory.FullHouse);
  });

  it("prefers the straight over a lower made hand", () => {
    const s = evaluateBest(hand("9s", "8h", "7d", "6c", "5s", "2h", "2d"));
    expect(categoryOf(s)).toBe(HandCategory.Straight);
  });
});
