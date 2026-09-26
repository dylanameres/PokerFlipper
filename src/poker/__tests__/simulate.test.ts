import { describe, expect, it } from "vitest";
import { parseCard } from "../cards";
import { simulate } from "../simulate";

function hole(a: string, b: string) {
  return { hole: [parseCard(a), parseCard(b)] };
}

describe("simulate", () => {
  it("gives aces a large edge over 72o preflop heads-up", () => {
    const result = simulate({
      players: [hole("As", "Ah"), hole("7d", "2c")],
      board: [],
      iterations: 20000,
    });
    // Pocket aces vs 72o is roughly 88% / 12%.
    expect(result.players[0].equity).toBeGreaterThan(80);
    expect(result.players[1].equity).toBeLessThan(20);
  });

  it("scores a locked-in winner at 100% equity", () => {
    const result = simulate({
      players: [hole("As", "Ks"), hole("Ah", "Kh")],
      // Board already gives player 0 a royal flush; nothing can catch it.
      board: [parseCard("Qs"), parseCard("Js"), parseCard("Ts")],
      iterations: 500,
    });
    expect(result.players[0].equity).toBe(100);
  });

  it("produces equities that sum to ~100% across players", () => {
    const result = simulate({
      players: [hole("Jc", "Jd"), hole("Ah", "Qh")],
      board: [],
      iterations: 10000,
    });
    const total =
      result.players[0].equity + result.players[1].equity;
    expect(total).toBeGreaterThan(99.5);
    expect(total).toBeLessThan(100.5);
  });
});
