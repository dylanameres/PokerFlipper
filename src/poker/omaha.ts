import type { Card } from "./cards";
import { evaluate5 } from "./evaluator";

/**
 * Omaha: must use exactly 2 hole cards and exactly 3 board cards.
 * Board must have at least 3 cards.
 */
export function evaluateOmaha(hole: Card[], board: Card[]): number {
  if (hole.length !== 4) {
    throw new Error("Omaha hole cards must be exactly 4");
  }
  if (board.length < 3) {
    throw new Error("Omaha needs at least 3 board cards to evaluate");
  }

  let best = 0;
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      for (let i = 0; i < board.length; i++) {
        for (let j = i + 1; j < board.length; j++) {
          for (let k = j + 1; k < board.length; k++) {
            const score = evaluate5([
              hole[a],
              hole[b],
              board[i],
              board[j],
              board[k],
            ]);
            if (score > best) best = score;
          }
        }
      }
    }
  }
  return best;
}
