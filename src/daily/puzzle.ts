import type { Card } from "../poker";
import { dayKey, puzzleNumber } from "./calendar";
import { rngForDay, seededDeck, type Rng } from "./rng";

/**
 * Everything a daily game needs to build today's puzzle. Every player gets the
 * same `deck` order and `rng` stream for a given day.
 */
export interface DailyPuzzle {
  day: string;
  number: number;
  deck: Card[];
  rng: Rng;
}

export function puzzleForDay(day: string): DailyPuzzle {
  const rng = rngForDay(day);
  return { day, number: puzzleNumber(day), deck: seededDeck(rng), rng };
}

export function todaysPuzzle(now: Date = new Date()): DailyPuzzle {
  return puzzleForDay(dayKey(now));
}
