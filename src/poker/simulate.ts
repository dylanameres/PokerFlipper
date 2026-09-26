import { fullDeck, parseCard, type Card } from "./cards";
import { evaluateBest } from "./evaluator";

export interface SimulateHandOptions {
  /** Hole cards per player, as strings like "As" / "Ah". Empty array = random. */
  hands: string[][];
  /** Community cards (0–5). */
  board?: string[];
  /** Monte Carlo iterations (default 20_000). */
  iterations?: number;
}

export interface SimulateHandResult {
  iterations: number;
  /** Equity % per player (wins + shared ties). Sums to ~100. */
  equities: number[];
  wins: number[];
  ties: number[];
  losses: number[];
}

function parseHand(cards: string[]): Card[] {
  return cards.map((c) => parseCard(c.trim()));
}

function shufflePrefix(deck: Card[], upTo: number): void {
  for (let i = 0; i < upTo; i++) {
    const j = i + Math.floor(Math.random() * (deck.length - i));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
}

/**
 * Monte Carlo equity for Texas Hold'em.
 *
 * @example
 * simulateHand({ hands: [["As", "Ah"], ["7d", "2c"]] })
 */
export function simulateHand(opts: SimulateHandOptions): SimulateHandResult {
  const iterations = opts.iterations ?? 20_000;
  if (opts.hands.length < 1) {
    throw new Error("Need at least one hand");
  }

  const players = opts.hands.map(parseHand);
  for (const hole of players) {
    if (hole.length > 2) throw new Error("Each hand can have at most 2 cards");
  }

  const board = (opts.board ?? []).map((c) => parseCard(c.trim()));
  if (board.length > 5) throw new Error("Board can have at most 5 cards");

  const known = new Set<Card>();
  for (const hole of players) {
    for (const c of hole) {
      if (known.has(c)) throw new Error(`Duplicate card: used more than once`);
      known.add(c);
    }
  }
  for (const c of board) {
    if (known.has(c)) throw new Error(`Duplicate card: used more than once`);
    known.add(c);
  }

  const remaining = fullDeck().filter((c) => !known.has(c));
  const n = players.length;
  const wins = new Array(n).fill(0);
  const ties = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  const equityAccum = new Array(n).fill(0);

  const boardNeeded = 5 - board.length;
  const holesNeeded = players.map((h) => 2 - h.length);
  const drawCount = boardNeeded + holesNeeded.reduce((a, b) => a + b, 0);
  const scores = new Array<number>(n);

  for (let iter = 0; iter < iterations; iter++) {
    shufflePrefix(remaining, drawCount);

    let cursor = 0;
    const fullBoard = board.slice();
    for (let i = 0; i < boardNeeded; i++) fullBoard.push(remaining[cursor++]);

    let best = -1;
    for (let pi = 0; pi < n; pi++) {
      const hole = players[pi].slice();
      for (let i = 0; i < holesNeeded[pi]; i++) hole.push(remaining[cursor++]);
      const score = evaluateBest([...hole, ...fullBoard]);
      scores[pi] = score;
      if (score > best) best = score;
    }

    let winners = 0;
    for (let pi = 0; pi < n; pi++) if (scores[pi] === best) winners++;
    for (let pi = 0; pi < n; pi++) {
      if (scores[pi] === best) {
        if (winners === 1) wins[pi]++;
        else ties[pi]++;
        equityAccum[pi] += 1 / winners;
      } else {
        losses[pi]++;
      }
    }
  }

  return {
    iterations,
    equities: equityAccum.map((e) => (e / iterations) * 100),
    wins,
    ties,
    losses,
  };
}
