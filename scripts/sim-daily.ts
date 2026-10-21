// Rough balance check: a player who always guesses a hand consistent with all feedback so far.
// Usage: npx vite-node scripts/sim-daily.ts <days> [clue]
import { categoryOf, evaluate5 } from "../src/poker/evaluator";
import { addDays } from "../src/daily/calendar";
import { categoryForPuzzle, handOfCategory, scoreGuess, type CardFeedback } from "../src/daily/guessHand";
import { puzzleForDay } from "../src/daily/puzzle";
import { mulberry32 } from "../src/daily/rng";

const all: number[][] = [];
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++)
    for (let c = b + 1; c < 52; c++)
      for (let d = c + 1; d < 52; d++)
        for (let e = d + 1; e < 52; e++) all.push([e, d, c, b, a]);
const cats = all.map((h) => categoryOf(evaluate5(h)));

const sig = (f: CardFeedback[]) => f.map((x) => x.card + x.mark + (x.color ?? "")).join("|");

const days = Number(process.argv[2] ?? 30);
const useClue = process.argv[3] === "clue";
const rng = mulberry32(1);
const results: Record<string, number[]> = {};
for (let i = 0; i < days; i++) {
  const { rng: prng, number } = puzzleForDay(addDays("2026-10-20", i));
  const cat = categoryForPuzzle(number);
  const answer = handOfCategory(cat, prng);
  let idx = all.map((_, j) => j).filter((j) => !useClue || cats[j] === cat);
  let n = 0;
  for (;;) {
    n++;
    const guess = all[idx[Math.floor(rng() * idx.length)]];
    const fb = scoreGuess(guess, answer);
    if (fb.every((f) => f.mark === "green")) break;
    const s = sig(fb);
    idx = idx.filter((j) => sig(scoreGuess(guess, all[j])) === s);
  }
  (results[cat] ??= []).push(n);
}
for (const [cat, ns] of Object.entries(results)) {
  const win = ns.filter((n) => n <= 6).length;
  console.log(`cat ${cat}: n=${ns.length} avg=${(ns.reduce((a, b) => a + b, 0) / ns.length).toFixed(2)} solved<=6=${win}/${ns.length} max=${Math.max(...ns)}`);
}
const flat = Object.values(results).flat();
console.log(`ALL (${useClue ? "clue" : "no clue"}): avg=${(flat.reduce((a, b) => a + b, 0) / flat.length).toFixed(2)} solved<=6=${flat.filter((n) => n <= 6).length}/${flat.length}`);
