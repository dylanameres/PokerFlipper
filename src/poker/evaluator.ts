import { cardRank, cardSuit, type Card } from "./cards";

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
}

export const HAND_CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.HighCard]: "High Card",
  [HandCategory.Pair]: "Pair",
  [HandCategory.TwoPair]: "Two Pair",
  [HandCategory.ThreeOfAKind]: "Three of a Kind",
  [HandCategory.Straight]: "Straight",
  [HandCategory.Flush]: "Flush",
  [HandCategory.FullHouse]: "Full House",
  [HandCategory.FourOfAKind]: "Four of a Kind",
  [HandCategory.StraightFlush]: "Straight Flush",
};

const BASE = 15;

/**
 * Encode a hand category plus up to 5 ordered tiebreaker ranks into a single
 * comparable integer. Higher is better.
 */
function encode(category: HandCategory, kickers: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) {
    score = score * BASE + (kickers[i] ?? 0);
  }
  return score;
}

/**
 * Given exactly 5 cards, return the best straight high card (0 if none).
 * Handles the wheel (A-2-3-4-5) where the Ace plays low.
 */
function straightHigh(sortedUniqueDesc: number[]): number {
  const ranks = sortedUniqueDesc;
  // Add the low ace for wheel detection.
  const withLowAce = ranks.includes(14) ? [...ranks, 1] : ranks;
  let run = 1;
  for (let i = 1; i < withLowAce.length; i++) {
    if (withLowAce[i] === withLowAce[i - 1] - 1) {
      run++;
      if (run >= 5) {
        return withLowAce[i] + 4;
      }
    } else if (withLowAce[i] !== withLowAce[i - 1]) {
      run = 1;
    }
  }
  return 0;
}

/**
 * Evaluate a 5-card poker hand. Returns a comparable integer score.
 */
export function evaluate5(cards: Card[]): number {
  const ranks = cards.map(cardRank);
  const suits = cards.map(cardSuit);

  const isFlush = suits.every((s) => s === suits[0]);

  // Count occurrences of each rank.
  const counts = new Map<number, number>();
  for (const r of ranks) {
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }

  // Sort ranks by (count desc, rank desc) for kicker ordering.
  const byCount = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const uniqueDesc = [...counts.keys()].sort((a, b) => b - a);
  const straight = straightHigh(uniqueDesc);

  if (isFlush && straight) {
    return encode(HandCategory.StraightFlush, [straight]);
  }

  const countShape = byCount.map((e) => e[1]).join("");
  const orderedRanks = byCount.map((e) => e[0]);

  if (countShape === "41") {
    return encode(HandCategory.FourOfAKind, orderedRanks);
  }
  if (countShape === "32") {
    return encode(HandCategory.FullHouse, orderedRanks);
  }
  if (isFlush) {
    return encode(HandCategory.Flush, uniqueDesc);
  }
  if (straight) {
    return encode(HandCategory.Straight, [straight]);
  }
  if (countShape === "311") {
    return encode(HandCategory.ThreeOfAKind, orderedRanks);
  }
  if (countShape === "221") {
    return encode(HandCategory.TwoPair, orderedRanks);
  }
  if (countShape === "2111") {
    return encode(HandCategory.Pair, orderedRanks);
  }
  return encode(HandCategory.HighCard, uniqueDesc);
}

const COMBINATIONS_7_CHOOSE_5: number[][] = (() => {
  const combos: number[][] = [];
  for (let a = 0; a < 7; a++) {
    for (let b = a + 1; b < 7; b++) {
      const chosen: number[] = [];
      for (let i = 0; i < 7; i++) {
        if (i !== a && i !== b) chosen.push(i);
      }
      combos.push(chosen);
    }
  }
  return combos;
})();

/**
 * Evaluate the best 5-card hand from 5, 6, or 7 cards.
 */
export function evaluateBest(cards: Card[]): number {
  if (cards.length === 5) {
    return evaluate5(cards);
  }
  if (cards.length === 7) {
    let best = 0;
    for (const combo of COMBINATIONS_7_CHOOSE_5) {
      const hand = [
        cards[combo[0]],
        cards[combo[1]],
        cards[combo[2]],
        cards[combo[3]],
        cards[combo[4]],
      ];
      const score = evaluate5(hand);
      if (score > best) best = score;
    }
    return best;
  }
  // General fallback for 6 cards (or any length) via combinations.
  let best = 0;
  const n = cards.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          for (let e = d + 1; e < n; e++) {
            const score = evaluate5([
              cards[a],
              cards[b],
              cards[c],
              cards[d],
              cards[e],
            ]);
            if (score > best) best = score;
          }
        }
      }
    }
  }
  return best;
}

export function categoryOf(score: number): HandCategory {
  return Math.floor(score / BASE ** 5) as HandCategory;
}
