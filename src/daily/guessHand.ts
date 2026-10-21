import { cardRank, cardSuit, makeCard, RANKS, SUITS, type Card } from "../poker/cards";
import { categoryOf, evaluate5, HandCategory } from "../poker/evaluator";
import { rngForDay, seededShuffle, type Rng } from "./rng";

export const HAND_SIZE = 5;
export const MAX_GUESSES = 6;

export type Mark = "green" | "yellow" | "gray";
export type SuitColor = "red" | "black";

export interface CardFeedback {
  card: Card;
  mark: Mark;
  /** Yellow only: color of the hidden card this guess matched by rank. */
  color?: SuitColor;
}

export const ALL_CATEGORIES: readonly HandCategory[] = [
  HandCategory.HighCard,
  HandCategory.Pair,
  HandCategory.TwoPair,
  HandCategory.ThreeOfAKind,
  HandCategory.Straight,
  HandCategory.Flush,
  HandCategory.FullHouse,
  HandCategory.FourOfAKind,
  HandCategory.StraightFlush,
];

/** How many cards share each rank, for the rank-grouped categories. */
const RANK_GROUPS: Partial<Record<HandCategory, number[]>> = {
  [HandCategory.HighCard]: [1, 1, 1, 1, 1],
  [HandCategory.Pair]: [2, 1, 1, 1],
  [HandCategory.TwoPair]: [2, 2, 1],
  [HandCategory.ThreeOfAKind]: [3, 1, 1],
  [HandCategory.Flush]: [1, 1, 1, 1, 1],
  [HandCategory.FullHouse]: [3, 2],
  [HandCategory.FourOfAKind]: [4, 1],
};

const SUIT_INDEXES = [0, 1, 2, 3];
const RANK_INDEXES = RANKS.map((_, i) => i);

function card(rankIndex: number, suitIndex: number): Card {
  return makeCard(RANKS[rankIndex], SUITS[suitIndex]);
}

function pick(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

function candidateHand(category: HandCategory, rng: Rng): Card[] {
  if (category === HandCategory.Straight || category === HandCategory.StraightFlush) {
    // Top rank index 3 is the wheel (5-high, ace plays low) up to 12 (ace-high).
    const top = 3 + pick(rng, 10);
    const ranks = [0, 1, 2, 3, 4].map((i) => (top - i + 13) % 13);
    const flushSuit = pick(rng, 4);
    return ranks.map((r) =>
      card(r, category === HandCategory.StraightFlush ? flushSuit : pick(rng, 4)),
    );
  }

  const groups = RANK_GROUPS[category]!;
  const ranks = seededShuffle(RANK_INDEXES, rng).slice(0, groups.length);
  const flushSuit = pick(rng, 4);
  return groups.flatMap((size, g) => {
    if (category === HandCategory.Flush) return [card(ranks[g], flushSuit)];
    const suits = seededShuffle(SUIT_INDEXES, rng).slice(0, size);
    return suits.map((s) => card(ranks[g], s));
  });
}

/**
 * Puzzles run in cycles of nine days, each hand type once per cycle in a
 * shuffled order, so every type is equally common and none goes missing for weeks.
 */
export function categoryForPuzzle(puzzleNumber: number): HandCategory {
  const index = puzzleNumber - 1;
  const cycle = Math.floor(index / ALL_CATEGORIES.length);
  const order = seededShuffle(ALL_CATEGORIES, rngForDay(`cycle-${cycle}`, "pokerflipper-daily-types"));
  return order[index % ALL_CATEGORIES.length];
}

/** A hidden hand of exactly `category` (rerolls accidental straights/flushes). */
export function handOfCategory(category: HandCategory, rng: Rng): Card[] {
  for (;;) {
    const hand = candidateHand(category, rng);
    if (categoryOf(evaluate5(hand)) === category) return sortCards(hand);
  }
}

/** High to low by rank, then by suit, so equal hands always read the same. */
export function sortCards(cards: readonly Card[]): Card[] {
  return cards.slice().sort((a, b) => b - a);
}

export function suitColor(c: Card): SuitColor {
  const suit = SUITS[cardSuit(c)];
  return suit === "h" || suit === "d" ? "red" : "black";
}

/**
 * Order-independent scoring. Exact cards are green; then each remaining hidden
 * card can turn at most one guessed card of its rank yellow, preferring a
 * same-color pairing so the color hint is as informative as possible.
 */
export function scoreGuess(guess: readonly Card[], answer: readonly Card[]): CardFeedback[] {
  const answerSet = new Set(answer);
  const sorted = sortCards(guess);
  const feedback: CardFeedback[] = sorted.map((c) => ({
    card: c,
    mark: answerSet.has(c) ? "green" : "gray",
  }));

  const unmatched = answer.filter((c) => !guess.includes(c));
  const claim = (sameColorOnly: boolean) => {
    for (const fb of feedback) {
      if (fb.mark !== "gray") continue;
      const i = unmatched.findIndex(
        (a) =>
          cardRank(a) === cardRank(fb.card) &&
          (!sameColorOnly || suitColor(a) === suitColor(fb.card)),
      );
      if (i < 0) continue;
      fb.mark = "yellow";
      fb.color = suitColor(unmatched[i]);
      unmatched.splice(i, 1);
    }
  };
  claim(true);
  claim(false);
  return feedback;
}

export function handCategory(hand: readonly Card[]): HandCategory {
  return categoryOf(evaluate5(hand.slice()));
}

/** True once any guess is the same hand type as the answer. */
export function categoryFound(guesses: readonly Card[][], answer: readonly Card[]): boolean {
  const target = handCategory(answer);
  return guesses.some((g) => handCategory(g) === target);
}

export function isSolved(feedback: readonly CardFeedback[]): boolean {
  return feedback.length === HAND_SIZE && feedback.every((f) => f.mark === "green");
}

const MARK_ORDER: Record<Mark, number> = { green: 0, yellow: 1, gray: 2 };

/** Best mark seen for each guessed card, for tinting the card picker. */
export function cardKnowledge(history: readonly CardFeedback[][]): Map<Card, Mark> {
  const known = new Map<Card, Mark>();
  for (const row of history) {
    for (const fb of row) {
      const prev = known.get(fb.card);
      if (!prev || MARK_ORDER[fb.mark] < MARK_ORDER[prev]) known.set(fb.card, fb.mark);
    }
  }
  return known;
}

const SHARE_SQUARE: Record<Mark, string> = { green: "🟩", yellow: "🟨", gray: "⬛" };

/** One square per card, in the same order as the guess row. */
export function shareRow(feedback: readonly CardFeedback[]): string {
  return feedback.map((f) => SHARE_SQUARE[f.mark]).join("");
}
