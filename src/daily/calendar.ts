/** Local date of puzzle #1. Puzzles roll over at the player's local midnight. */
export const DAILY_EPOCH = "2026-10-20";

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` in the player's local time zone. */
export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function keyToUtcMs(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((keyToUtcMs(to) - keyToUtcMs(from)) / MS_PER_DAY);
}

export function addDays(key: string, days: number): string {
  const ms = keyToUtcMs(key) + days * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

/** 1-based puzzle number; days before the epoch clamp to #1. */
export function puzzleNumber(key: string): number {
  return Math.max(1, daysBetween(DAILY_EPOCH, key) + 1);
}

export function msUntilNextDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function formatDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
