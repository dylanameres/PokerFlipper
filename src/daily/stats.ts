import { addDays } from "./calendar";

export type DailyStatus = "playing" | "won" | "lost";

/** One player's attempt at one day's puzzle. `moves` is game-specific. */
export interface DailyProgress<Move = unknown> {
  day: string;
  status: DailyStatus;
  moves: Move[];
}

export interface DailyStats {
  played: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  /** Last day a result was recorded, used to keep streaks consecutive. */
  lastPlayedDay: string | null;
  lastWonDay: string | null;
}

export const EMPTY_STATS: DailyStats = {
  played: 0,
  wins: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastPlayedDay: null,
  lastWonDay: null,
};

/** Records a finished puzzle. Recording the same day twice is a no-op. */
export function recordResult(
  stats: DailyStats,
  day: string,
  won: boolean,
): DailyStats {
  if (stats.lastPlayedDay === day) return stats;
  const continues = won && stats.lastWonDay === addDays(day, -1);
  const currentStreak = won ? (continues ? stats.currentStreak + 1 : 1) : 0;
  return {
    played: stats.played + 1,
    wins: stats.wins + (won ? 1 : 0),
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
    lastPlayedDay: day,
    lastWonDay: won ? day : stats.lastWonDay,
  };
}

/** Streak as of `today`: a streak survives until a full day is skipped. */
export function liveStreak(stats: DailyStats, today: string): number {
  if (!stats.lastWonDay) return 0;
  if (stats.lastWonDay === today || stats.lastWonDay === addDays(today, -1)) {
    return stats.currentStreak;
  }
  return 0;
}

export function winRate(stats: DailyStats): number {
  return stats.played === 0 ? 0 : Math.round((stats.wins / stats.played) * 100);
}

const STATS_KEY = "pokerflipper-daily-stats";
const PROGRESS_KEY = "pokerflipper-daily-progress";

export function loadStats(): DailyStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { ...EMPTY_STATS };
    return { ...EMPTY_STATS, ...(JSON.parse(raw) as Partial<DailyStats>) };
  } catch {
    return { ...EMPTY_STATS };
  }
}

export function saveStats(stats: DailyStats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // ignore quota / private-mode failures
  }
}

/** Only today's progress is kept; a stale day starts fresh. */
export function loadProgress<Move>(day: string): DailyProgress<Move> {
  const fresh: DailyProgress<Move> = { day, status: "playing", moves: [] };
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as DailyProgress<Move>;
    return parsed.day === day && Array.isArray(parsed.moves) ? parsed : fresh;
  } catch {
    return fresh;
  }
}

export function saveProgress<Move>(progress: DailyProgress<Move>) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // ignore quota / private-mode failures
  }
}
