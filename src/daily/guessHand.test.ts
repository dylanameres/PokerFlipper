import { describe, expect, it } from "vitest";
import { parseCard, type Card } from "../poker/cards";
import { categoryOf, evaluate5, HandCategory } from "../poker/evaluator";
import {
  ALL_CATEGORIES,
  cardKnowledge,
  categoryFound,
  categoryForPuzzle,
  handOfCategory,
  isSolved,
  scoreGuess,
  shareRow,
} from "./guessHand";
import { puzzleForDay } from "./puzzle";
import { mulberry32 } from "./rng";

const cards = (text: string): Card[] => text.split(" ").map(parseCard);

const MARK_CODE = { green: "G", yellow: "Y", gray: "X" } as const;

function marks(guess: string, answer: string): string {
  return scoreGuess(cards(guess), cards(answer))
    .map((f) => `${MARK_CODE[f.mark]}${f.color ? `:${f.color}` : ""}`)
    .join(" ");
}

describe("hand generation", () => {
  it("builds five distinct cards of exactly the requested category", () => {
    const rng = mulberry32(42);
    for (const category of ALL_CATEGORIES) {
      for (let i = 0; i < 200; i++) {
        const hand = handOfCategory(category, rng);
        expect(new Set(hand).size).toBe(5);
        expect(categoryOf(evaluate5(hand))).toBe(category);
      }
    }
  });

  it("includes wheel and broadway straights", () => {
    const rng = mulberry32(7);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      seen.add(handOfCategory(HandCategory.Straight, rng).map((c) => c >> 2).join(","));
    }
    expect(seen.has("12,3,2,1,0")).toBe(true);
    expect(seen.has("12,11,10,9,8")).toBe(true);
    expect(seen.size).toBe(10);
  });

  it("uses every hand type exactly once per nine-day cycle", () => {
    for (let cycle = 0; cycle < 50; cycle++) {
      const types = Array.from({ length: 9 }, (_, i) => categoryForPuzzle(cycle * 9 + i + 1));
      expect(new Set(types).size).toBe(ALL_CATEGORIES.length);
    }
    const firstCycles = [1, 10, 19].map((start) =>
      Array.from({ length: 9 }, (_, i) => categoryForPuzzle(start + i)).join(),
    );
    expect(new Set(firstCycles).size).toBeGreaterThan(1);
  });

  it("is the same hand for everyone on a given day", () => {
    const build = () => {
      const { rng, number } = puzzleForDay("2026-10-21");
      return handOfCategory(categoryForPuzzle(number), rng);
    };
    expect(build()).toEqual(build());
  });
});

describe("scoring", () => {
  // Feedback is listed high card first.
  it("marks exact, rank-only and missing cards regardless of order", () => {
    expect(marks("5s Kd 7h As Ah", "As Ah Kd Kc 5s")).toBe("G G G X G");
    expect(marks("Ac Ad Qs Kh 2c", "As Ah Kd Kc 5s")).toBe("Y:black Y:red Y:red X X");
  });

  it("only gives as many yellows as hidden cards of that rank", () => {
    expect(marks("As Ah Ad 2c 3c", "As Ac Kd Kc 5s")).toBe("Y:black X G X X");
  });

  it("prefers a same-color pairing for the color hint", () => {
    expect(marks("As Ad 2c 3c 4c", "Ac Ah Kd Kc 5s")).toBe("Y:red Y:black X X X");
  });

  it("finds the hand type once any guess matches it", () => {
    const answer = cards("8c 8d 8h 8s 4s");
    expect(categoryFound([cards("As Ah Kd Kc 5s")], answer)).toBe(false);
    expect(categoryFound([cards("As Ah Kd Kc 5s"), cards("2s 2h 2d 2c Ks")], answer)).toBe(true);
  });

  it("solves only when all five match", () => {
    expect(isSolved(scoreGuess(cards("As Ah Kd Kc 5s"), cards("5s Kc Kd Ah As")))).toBe(true);
    expect(isSolved(scoreGuess(cards("As Ah Kd Kc 5h"), cards("5s Kc Kd Ah As")))).toBe(false);
  });

  it("remembers the best mark per card and shares squares in guess order", () => {
    const answer = cards("As Ah Kd Kc 5s");
    const first = scoreGuess(cards("Ad 2c 3c 4c 6c"), answer);
    const second = scoreGuess(cards("Ad Kd 9c 4c 3c"), answer);
    const known = cardKnowledge([first, second]);
    expect(known.get(parseCard("Kd"))).toBe("green");
    expect(known.get(parseCard("Ad"))).toBe("yellow");
    expect(known.get(parseCard("2c"))).toBe("gray");
    // Rank order is Ad, Kd, 9c, 4c, 3c — yellow stays on the ace, not grouped left.
    expect(shareRow(second)).toBe("🟨🟩⬛⬛⬛");
  });
});
