import { fullDeck, type Card } from "./cards";
import { evaluateBest } from "./evaluator";
import type { GameType } from "./game";
import { evaluateOmaha } from "./omaha";

export function scoreHand(
  gameType: GameType,
  hole: Card[],
  board: Card[],
): number {
  if (gameType === "omaha") {
    return evaluateOmaha(hole, board);
  }
  return evaluateBest([...hole, ...board]);
}

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = (result * (n - k + i)) / i;
  }
  return Math.round(result);
}

function* chooseIndices(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

function knownCards(hands: Card[][], board: Card[]): Set<Card> {
  const used = new Set<Card>();
  for (const h of hands) for (const c of h) used.add(c);
  for (const c of board) used.add(c);
  return used;
}

/**
 * Equity % for each player given fully known hole cards and a partial board.
 * Uses exact enumeration when the remaining runouts are small; otherwise Monte Carlo.
 */
export function liveEquity(
  gameType: GameType,
  hands: Card[][],
  board: Card[],
  iterations = 20_000,
): number[] {
  const n = hands.length;
  const used = knownCards(hands, board);
  const remaining = fullDeck().filter((c) => !used.has(c));
  const need = 5 - board.length;

  if (need === 0) {
    const scores = hands.map((h) => scoreHand(gameType, h, board));
    let best = -1;
    for (const s of scores) if (s > best) best = s;
    let winners = 0;
    for (const s of scores) if (s === best) winners++;
    return scores.map((s) => (s === best ? 100 / winners : 0));
  }

  const total = combinations(remaining.length, need);
  const equities = new Array(n).fill(0);

  const settle = (fullBoard: Card[]) => {
    const scores = hands.map((h) => scoreHand(gameType, h, fullBoard));
    let best = -1;
    for (const s of scores) if (s > best) best = s;
    let winners = 0;
    for (const s of scores) if (s === best) winners++;
    for (let i = 0; i < n; i++) {
      if (scores[i] === best) equities[i] += 1 / winners;
    }
  };

  if (total <= 80_000) {
    let count = 0;
    for (const idxs of chooseIndices(remaining.length, need)) {
      const fullBoard = board.concat(idxs.map((i) => remaining[i]));
      settle(fullBoard);
      count++;
    }
    return equities.map((e) => (e / count) * 100);
  }

  // Monte Carlo for large preflop trees.
  for (let iter = 0; iter < iterations; iter++) {
    // Partial Fisher–Yates for `need` cards.
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (remaining.length - i));
      const tmp = remaining[i];
      remaining[i] = remaining[j];
      remaining[j] = tmp;
    }
    settle(board.concat(remaining.slice(0, need)));
  }
  return equities.map((e) => (e / iterations) * 100);
}

export interface OutsResult {
  /** Cards that put this player strictly ahead after one more board card. */
  outs: Card[];
  /** How many unseen cards were checked. */
  candidates: number;
}

/**
 * Cards that, if dealt as the next community card, put `playerIndex`
 * strictly in the lead (best hand at that street).
 * Only meaningful on the flop or turn (board length 3 or 4).
 */
export function findOuts(
  gameType: GameType,
  hands: Card[][],
  board: Card[],
  playerIndex: number,
): OutsResult {
  if (board.length < 3 || board.length > 4) {
    return { outs: [], candidates: 0 };
  }

  const used = knownCards(hands, board);
  const remaining = fullDeck().filter((c) => !used.has(c));
  const outs: Card[] = [];

  for (const card of remaining) {
    const nextBoard = [...board, card];
    const scores = hands.map((h) => scoreHand(gameType, h, nextBoard));
    const mine = scores[playerIndex];
    let ahead = true;
    for (let i = 0; i < scores.length; i++) {
      if (i === playerIndex) continue;
      if (scores[i] >= mine) {
        ahead = false;
        break;
      }
    }
    if (ahead) outs.push(card);
  }

  // Sort by rank then suit for a stable display.
  outs.sort((a, b) => b - a);
  return { outs, candidates: remaining.length };
}
