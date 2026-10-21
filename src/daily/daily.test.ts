import { describe, expect, it } from "vitest";
import { routeForPath } from "../site/routes";
import {
  addDays,
  DAILY_EPOCH,
  dayKey,
  daysBetween,
  formatCountdown,
  msUntilNextDay,
  puzzleNumber,
} from "./calendar";
import { puzzleForDay } from "./puzzle";
import { mulberry32, seededShuffle } from "./rng";
import { EMPTY_STATS, liveStreak, recordResult, winRate } from "./stats";

describe("calendar", () => {
  it("formats local day keys", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("counts days across month, year and DST boundaries", () => {
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("numbers puzzles from the epoch", () => {
    expect(puzzleNumber(DAILY_EPOCH)).toBe(1);
    expect(puzzleNumber(addDays(DAILY_EPOCH, 9))).toBe(10);
    expect(puzzleNumber("2020-01-01")).toBe(1);
  });

  it("counts down to local midnight", () => {
    expect(msUntilNextDay(new Date(2026, 4, 1, 23, 0, 0))).toBe(3_600_000);
    expect(formatCountdown(3_723_000)).toBe("01:02:03");
  });
});

describe("seeded puzzles", () => {
  it("deals the same deck for the same day", () => {
    const a = puzzleForDay("2026-10-21");
    const b = puzzleForDay("2026-10-21");
    expect(a.deck).toEqual(b.deck);
    expect(a.rng()).toBe(b.rng());
  });

  it("deals a full, distinct deck that changes day to day", () => {
    const today = puzzleForDay("2026-10-21").deck;
    expect(new Set(today).size).toBe(52);
    expect(puzzleForDay("2026-10-22").deck).not.toEqual(today);
  });

  it("shuffles without mutating input", () => {
    const input = [1, 2, 3, 4, 5];
    const out = seededShuffle(input, mulberry32(7));
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual(input);
  });
});

describe("stats", () => {
  it("builds streaks on consecutive wins and resets on a loss", () => {
    let s = recordResult(EMPTY_STATS, "2026-10-20", true);
    s = recordResult(s, "2026-10-21", true);
    expect(s.currentStreak).toBe(2);
    s = recordResult(s, "2026-10-22", false);
    expect(s).toMatchObject({ played: 3, wins: 2, currentStreak: 0, maxStreak: 2 });
    expect(winRate(s)).toBe(67);
  });

  it("counts wins by number of guesses", () => {
    let s = recordResult(EMPTY_STATS, "2026-10-20", true, 3);
    s = recordResult(s, "2026-10-21", false, 6);
    expect(s.guessCounts).toEqual([0, 0, 1, 0, 0, 0]);
    expect(EMPTY_STATS.guessCounts).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("restarts the streak after a skipped day", () => {
    let s = recordResult(EMPTY_STATS, "2026-10-20", true);
    s = recordResult(s, "2026-10-22", true);
    expect(s.currentStreak).toBe(1);
  });

  it("ignores a second result for the same day", () => {
    const s = recordResult(EMPTY_STATS, "2026-10-20", true);
    expect(recordResult(s, "2026-10-20", false)).toBe(s);
  });

  it("shows the streak only while it is still alive", () => {
    const s = recordResult(EMPTY_STATS, "2026-10-20", true);
    expect(liveStreak(s, "2026-10-20")).toBe(1);
    expect(liveStreak(s, "2026-10-21")).toBe(1);
    expect(liveStreak(s, "2026-10-22")).toBe(0);
  });
});

describe("routes", () => {
  it("resolves paths, trailing slashes and unknown paths", () => {
    expect(routeForPath("/").id).toBe("table");
    expect(routeForPath("/daily/").id).toBe("daily");
    expect(routeForPath("/Daily").id).toBe("daily");
    expect(routeForPath("/nope").id).toBe("table");
  });
});
