import { describe, expect, it } from "vitest";
import {
  BIG_BLIND,
  MAX_ONLINE_PLAYERS,
  MIN_ONLINE_PLAYERS,
  ROOM_PROTOCOL,
  SMALL_BLIND,
  STARTING_CHIPS,
} from "../../shared/protocol";
import { PokerTable } from "./table";

function seatedTable(n: number) {
  let views = 0;
  const table = new PokerTable(() => {
    views += 1;
  });
  table.ensureSeats();
  const ids = Array.from({ length: n }, (_, i) => `c${i}`);
  for (const id of ids) {
    const r = table.seatPlayer(id);
    expect(r.ok).toBe(true);
  }
  return { table, ids, getViews: () => views };
}

describe("PokerTable multiplayer framework", () => {
  it("allows up to MAX seats and rejects the next join", () => {
    const { table } = seatedTable(MAX_ONLINE_PLAYERS);
    const full = table.seatPlayer("overflow");
    expect(full.ok).toBe(false);
    if (!full.ok) {
      expect(full.message).toMatch(/full/i);
    }
  });

  it("deals with MIN players even when seats remain empty", () => {
    const { table, ids } = seatedTable(MIN_ONLINE_PLAYERS);
    expect(table.readyToDeal()).toBe(true);
    table.handle({ type: "hello", gameType: "holdem" }, ids[0]);
    table.handle({ type: "deal_hands" }, ids[0]);

    const v0 = table.viewFor(ids[0], "TEST");
    const v1 = table.viewFor(ids[1], "TEST");
    expect(v0.protocol).toBe(ROOM_PROTOCOL);
    expect(v0.maxSeats).toBe(MAX_ONLINE_PLAYERS);
    expect(v0.seatedCount).toBe(2);
    expect(v0.street).toBe("holes");
    expect(v0.yourHoles.every((c) => c !== null)).toBe(true);
    expect(v1.yourHoles.every((c) => c !== null)).toBe(true);
    // Private holes differ between seats.
    expect(v0.yourHoles).not.toEqual(v1.yourHoles);

    // Empty seats stay empty; only filled seats get cards.
    const empty = v0.seats.filter((s) => !s.filled);
    expect(empty.length).toBe(MAX_ONLINE_PLAYERS - 2);
    for (const s of empty) {
      expect(s.holeHidden).toBeUndefined();
      expect(s.holes).toBeUndefined();
    }
  });

  it("posts HU blinds with dealer as BB and left seat as SB", () => {
    const { table, ids } = seatedTable(2);
    table.handle({ type: "deal_hands" }, ids[0]);
    const v = table.viewFor(ids[0], "HU");
    // buttonSeat 0 → SB is left filled (seat 1), BB is left of SB (seat 0 = button).
    expect(v.buttonSeat).toBe(0);
    expect(v.seats[0].isButton).toBe(true);
    expect(v.seats[0].isBigBlind).toBe(true);
    expect(v.seats[1].isSmallBlind).toBe(true);
    expect(v.pot).toBe(SMALL_BLIND + BIG_BLIND);
    expect(v.seats[0].chips).toBe(STARTING_CHIPS - BIG_BLIND);
    expect(v.seats[1].chips).toBe(STARTING_CHIPS - SMALL_BLIND);
  });

  it("assigns blinds among filled seats when middle seats are empty", () => {
    const table = new PokerTable(() => {});
    table.ensureSeats();
    // Force seats 0 and 2 with a gap (join always packs from the front).
    table.seats[0].connectionId = "a";
    table.seats[2].connectionId = "b";
    table.hostId = "a";
    expect(table.filledSeats()).toEqual([0, 2]);

    table.handle({ type: "deal_hands" }, "a");
    const v = table.viewFor("a", "GAP");
    expect(v.seats[0].isButton).toBe(true);
    // Left of 0 among filled → 2 is SB; left of 2 → 0 is BB.
    expect(v.seats[2].isSmallBlind).toBe(true);
    expect(v.seats[0].isBigBlind).toBe(true);
    expect(v.seats[1].filled).toBe(false);
    expect(v.seats[1].isSmallBlind).toBe(false);
    expect(v.seats[1].isBigBlind).toBe(false);
  });

  it("hides opponent holes until river showdown (per-seat + HU helpers)", () => {
    const { table, ids } = seatedTable(2);
    table.handle({ type: "deal_hands" }, ids[0]);
    const v = table.viewFor(ids[0], "PRIV");
    const opp = v.seats[1];
    expect(opp.holeHidden?.every(Boolean)).toBe(true);
    expect(opp.holes).toBeUndefined();
    expect(v.opponentHidden?.every(Boolean)).toBe(true);
    expect(v.yourHoles.every((c) => typeof c === "number")).toBe(true);
  });

  it("supports a 3-player deal and private hole views", () => {
    const { table, ids } = seatedTable(3);
    table.handle({ type: "deal_hands" }, ids[0]);
    const views = ids.map((id) => table.viewFor(id, "3P"));
    expect(views[0].seatedCount).toBe(3);
    expect(views[0].pot).toBe(SMALL_BLIND + BIG_BLIND);
    // Each player sees only their own face-up holes.
    for (let i = 0; i < 3; i++) {
      expect(views[i].yourSeat).toBe(i);
      expect(views[i].yourHoles.every((c) => c !== null)).toBe(true);
      for (let j = 0; j < 3; j++) {
        if (j === i) continue;
        expect(views[i].seats[j].holes).toBeUndefined();
        expect(views[i].seats[j].holeHidden?.every(Boolean)).toBe(true);
      }
    }
    // Deprecated HU helpers omitted when more than one opponent.
    expect(views[0].opponentHidden).toBeUndefined();
  });

  it("starts HU preflop action on the SB (non-button)", () => {
    const { table, ids } = seatedTable(2);
    table.handle({ type: "deal_hands" }, ids[0]);
    const v = table.viewFor(ids[0], "ACT");
    // Button/BB = 0; SB = 1 acts first preflop in HU.
    expect(v.actionSeat).toBe(1);
    expect(v.canAct).toBe(false);
    const vSb = table.viewFor(ids[1], "ACT");
    expect(vSb.canAct).toBe(true);
  });

  it("walks 3-handed preflop action left from the BB", () => {
    const { table, ids } = seatedTable(3);
    // button 0 → SB 2, BB 1; first to act = left of BB = 0 (button/UTG).
    table.handle({ type: "deal_hands" }, ids[0]);
    const v = table.viewFor(ids[0], "3ACT");
    expect(v.seats[0].isButton).toBe(true);
    expect(v.seats[2].isSmallBlind).toBe(true);
    expect(v.seats[1].isBigBlind).toBe(true);
    expect(v.actionSeat).toBe(0);
    table.handle({ type: "call" }, ids[0]); // UTG/button limp
    expect(table.viewFor(ids[0], "3ACT").actionSeat).toBe(2); // SB next
    table.handle({ type: "call" }, ids[2]);
    expect(table.viewFor(ids[0], "3ACT").actionSeat).toBe(1); // BB last
  });
});
