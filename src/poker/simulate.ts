import { fullDeck, type Card } from "./cards";
import { categoryOf, evaluateBest, HandCategory } from "./evaluator";

export interface PlayerInput {
  /** Known hole cards. Empty entries mean "deal randomly". */
  hole: Card[];
}

export interface SimulationInput {
  players: PlayerInput[];
  board: Card[];
  iterations: number;
}

export interface PlayerResult {
  wins: number;
  ties: number;
  losses: number;
  equity: number;
  winPct: number;
  tiePct: number;
  lossPct: number;
  /** Distribution of made-hand categories across all iterations. */
  categoryCounts: Record<HandCategory, number>;
}

export interface SimulationResult {
  iterations: number;
  players: PlayerResult[];
}

function shuffleInPlace(deck: Card[], upTo: number): void {
  // Fisher-Yates, only enough to fill the cards we need this iteration.
  for (let i = 0; i < upTo; i++) {
    const j = i + Math.floor(Math.random() * (deck.length - i));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
}

export function simulate(input: SimulationInput): SimulationResult {
  const { players, board, iterations } = input;

  const known = new Set<Card>();
  for (const p of players) {
    for (const c of p.hole) known.add(c);
  }
  for (const c of board) known.add(c);

  const remaining = fullDeck().filter((c) => !known.has(c));

  const results: PlayerResult[] = players.map(() => ({
    wins: 0,
    ties: 0,
    losses: 0,
    equity: 0,
    winPct: 0,
    tiePct: 0,
    lossPct: 0,
    categoryCounts: {
      [HandCategory.HighCard]: 0,
      [HandCategory.Pair]: 0,
      [HandCategory.TwoPair]: 0,
      [HandCategory.ThreeOfAKind]: 0,
      [HandCategory.Straight]: 0,
      [HandCategory.Flush]: 0,
      [HandCategory.FullHouse]: 0,
      [HandCategory.FourOfAKind]: 0,
      [HandCategory.StraightFlush]: 0,
    },
  }));

  const boardNeeded = 5 - board.length;
  const holesNeeded = players.map((p) => 2 - p.hole.length);
  const drawCount = boardNeeded + holesNeeded.reduce((a, b) => a + b, 0);

  const scores = new Array<number>(players.length);

  for (let iter = 0; iter < iterations; iter++) {
    shuffleInPlace(remaining, drawCount);

    let cursor = 0;
    const fullBoard = board.slice();
    for (let i = 0; i < boardNeeded; i++) {
      fullBoard.push(remaining[cursor++]);
    }

    let best = -1;
    for (let pi = 0; pi < players.length; pi++) {
      const hole = players[pi].hole.slice();
      for (let i = 0; i < holesNeeded[pi]; i++) {
        hole.push(remaining[cursor++]);
      }
      const score = evaluateBest([...hole, ...fullBoard]);
      scores[pi] = score;
      results[pi].categoryCounts[categoryOf(score)]++;
      if (score > best) best = score;
    }

    let winners = 0;
    for (let pi = 0; pi < players.length; pi++) {
      if (scores[pi] === best) winners++;
    }
    for (let pi = 0; pi < players.length; pi++) {
      if (scores[pi] === best) {
        if (winners === 1) {
          results[pi].wins++;
        } else {
          results[pi].ties++;
        }
        results[pi].equity += 1 / winners;
      } else {
        results[pi].losses++;
      }
    }
  }

  for (const r of results) {
    r.winPct = (r.wins / iterations) * 100;
    r.tiePct = (r.ties / iterations) * 100;
    r.lossPct = (r.losses / iterations) * 100;
    r.equity = (r.equity / iterations) * 100;
  }

  return { iterations, players: results };
}
