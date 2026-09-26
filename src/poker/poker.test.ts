import { describe, expect, it } from "vitest";
import { parseCard } from "./cards";
import { draw, shuffle } from "./deck";
import { findOuts, liveEquity } from "./equity";
import {
  categoryOf,
  evaluate5,
  evaluateBest,
  HandCategory,
} from "./evaluator";
import { HOLE_COUNT } from "./game";
import { evaluateOmaha } from "./omaha";
import { simulateHand } from "./simulate";

function hand(...cards: string[]) {
  return cards.map(parseCard);
}

describe("evaluate5", () => {
  it("ranks categories in order", () => {
    const scores = [
      evaluate5(hand("As", "Jh", "8d", "5c", "2s")), // high card
      evaluate5(hand("2s", "2h", "8d", "5c", "3s")), // pair
      evaluate5(hand("2s", "2h", "3d", "3c", "5s")), // two pair
      evaluate5(hand("2s", "2h", "2d", "5c", "8s")), // trips
      evaluate5(hand("9s", "8h", "7d", "6c", "5s")), // straight
      evaluate5(hand("As", "9s", "7s", "4s", "2s")), // flush
      evaluate5(hand("Ks", "Kh", "Kd", "2c", "2s")), // full house
      evaluate5(hand("9s", "9h", "9d", "9c", "2s")), // quads
      evaluate5(hand("9s", "8s", "7s", "6s", "5s")), // straight flush
    ];
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });

  it("handles the wheel straight", () => {
    expect(categoryOf(evaluate5(hand("As", "2h", "3d", "4c", "5s")))).toBe(
      HandCategory.Straight,
    );
  });

  it("picks the best 5 from 7", () => {
    expect(
      categoryOf(evaluateBest(hand("As", "Ks", "Qs", "2h", "3d", "9s", "5s"))),
    ).toBe(HandCategory.Flush);
  });
});

describe("simulateHand", () => {
  it("gives aces a large edge over 72o", () => {
    const result = simulateHand({
      hands: [
        ["As", "Ah"],
        ["7d", "2c"],
      ],
      iterations: 20000,
    });
    expect(result.equities[0]).toBeGreaterThan(80);
    expect(result.equities[1]).toBeLessThan(20);
  });

  it("locks in 100% when the board is already a royal", () => {
    const result = simulateHand({
      hands: [
        ["As", "Ks"],
        ["Ah", "Kh"],
      ],
      board: ["Qs", "Js", "Ts"],
      iterations: 500,
    });
    expect(result.equities[0]).toBe(100);
  });

  it("rejects duplicate cards", () => {
    expect(() =>
      simulateHand({
        hands: [
          ["As", "Ah"],
          ["As", "Kd"],
        ],
      }),
    ).toThrow(/Duplicate/);
  });

  it("accepts spaced string parsing via the public API shape", () => {
    const result = simulateHand({
      hands: [["Jc", "Jd"], []],
      iterations: 5000,
    });
    expect(result.equities[0] + result.equities[1]).toBeGreaterThan(99.5);
  });
});

describe("deck + game config", () => {
  it("shuffles a full 52-card deck with unique cards", () => {
    const deck = shuffle();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it("deals Hold'em holes then a flop without overlap", () => {
    const deck = shuffle();
    const players = 2;
    const holes = HOLE_COUNT.holdem;
    const dealt: number[] = [];
    for (let h = 0; h < holes; h++) {
      for (let p = 0; p < players; p++) {
        dealt.push(draw(deck, 1)[0]);
      }
    }
    draw(deck, 1); // burn
    const flop = draw(deck, 3);
    expect(dealt).toHaveLength(4);
    expect(flop).toHaveLength(3);
    expect(new Set([...dealt, ...flop]).size).toBe(7);
  });

  it("uses 4 hole cards for Omaha", () => {
    expect(HOLE_COUNT.omaha).toBe(4);
  });
});

describe("liveEquity + outs", () => {
  it("gives nearly 100% on the river when holding the nuts", () => {
    const eq = liveEquity(
      "holdem",
      [
        ["As", "Ks"].map(parseCard),
        ["Ah", "Kh"].map(parseCard),
      ],
      ["Qs", "Js", "Ts", "2d", "3c"].map(parseCard),
    );
    expect(eq[0]).toBe(100);
    expect(eq[1]).toBe(0);
  });

  it("updates flop equity for a flopped set vs overcards", () => {
    const eq = liveEquity(
      "holdem",
      [
        ["7s", "7h"].map(parseCard),
        ["As", "Kd"].map(parseCard),
      ],
      ["7d", "2c", "9h"].map(parseCard),
    );
    expect(eq[0]).toBeGreaterThan(85);
    expect(eq[1]).toBeLessThan(15);
  });

  it("lists turn outs that put the trailer ahead", () => {
    // Pair of aces vs flush draw — hearts are outs for the draw.
    const hands = [
      ["As", "Kd"].map(parseCard),
      ["5h", "4h"].map(parseCard),
    ];
    const board = ["Ah", "7h", "2c"].map(parseCard);
    const { outs, candidates } = findOuts("holdem", hands, board, 1);
    expect(candidates).toBeGreaterThan(40);
    const heartOuts = outs.filter((c) => (c & 3) === 1);
    expect(heartOuts.length).toBeGreaterThanOrEqual(8);
  });

  it("evaluates Omaha using exactly two hole cards", () => {
    // Four aces in hand can't make quads — only two hole cards play.
    const score = evaluateOmaha(
      ["As", "Ah", "Ad", "Ac"].map(parseCard),
      ["2s", "3h", "4d", "5c", "9s"].map(parseCard),
    );
    // Best is Ace-high straight (A + 2,3,4,5) using two hole + three board...
    // Actually A + 2,3,4,5 uses one ace from hole and board 2,3,4,5 - only 3 board?
    // Omaha needs exactly 3 board: A,A + 2,3,4 = pair of aces; A + 3,4,5 + 2 from...
    // Pair of aces with kickers is expected, not quads.
    expect(categoryOf(score)).toBe(HandCategory.Pair);
  });
});
