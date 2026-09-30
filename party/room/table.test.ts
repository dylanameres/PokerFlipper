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

  it("sits late joiners out of the current hand with a clean seat", () => {
    const { table, ids } = seatedTable(2);
    table.handle({ type: "deal_hands" }, ids[0]);
    const holesBefore = table.viewFor(ids[0], "X").yourHoles.slice();

    const joined = table.seatPlayer("late");
    expect(joined.ok).toBe(true);
    const late = table.viewFor("late", "X");
    expect(late.seats[late.yourSeat!].inHand).toBe(false);
    expect(late.yourHoles.every((c) => c === null)).toBe(true);
    expect(late.canAct).toBe(false);
    expect(late.status).toMatch(/sitting out/i);
    // Host still has the same private holes (no reseat leak / reshuffle).
    expect(table.viewFor(ids[0], "X").yourHoles).toEqual(holesBefore);
    // Late joiner cannot act even if somehow to act.
    expect(() => table.handle({ type: "call" }, "late")).toThrow(/sitting out/i);
  });

  it("awards the pot when the opponent disconnects mid-hand", () => {
    const { table, ids } = seatedTable(2);
    table.handle({ type: "deal_hands" }, ids[0]);
    const before = table.viewFor(ids[0], "DC");
    expect(before.handOver).toBe(false);
    const hostChips = before.seats[0].chips;
    const pot = before.pot;

    table.unseatPlayer(ids[1]);
    const after = table.viewFor(ids[0], "DC");
    expect(after.handOver).toBe(true);
    expect(after.winnerSeats).toEqual([0]);
    expect(after.seats[0].chips).toBe(hostChips + pot);
    expect(after.seats[1].filled).toBe(false);
  });

  it("does not leak vacated hole cards to the next occupant", () => {
    const { table, ids } = seatedTable(3);
    table.handle({ type: "deal_hands" }, ids[0]);
    const victimHoles = table.viewFor(ids[2], "L").yourHoles.slice();
    expect(victimHoles.every((c) => c !== null)).toBe(true);

    // Seat 2 folds out via disconnect; hand continues with 2 players.
    table.unseatPlayer(ids[2]);
    expect(table.viewFor(ids[0], "L").seats[2].filled).toBe(false);

    const joined = table.seatPlayer("newbie");
    expect(joined.ok).toBe(true);
    expect(joined.ok && joined.seat).toBe(2);
    const newbie = table.viewFor("newbie", "L");
    expect(newbie.yourHoles.every((c) => c === null)).toBe(true);
    expect(newbie.yourHoles).not.toEqual(victimHoles);
    expect(newbie.seats[2].inHand).toBe(false);
    expect(newbie.seats[2].chips).toBe(STARTING_CHIPS);
  });

  it("keeps deal-time blind markers after a third player leaves", () => {
    const { table, ids } = seatedTable(3);
    table.handle({ type: "deal_hands" }, ids[0]);
    // button 0, SB 2, BB 1 — remove UTG/button after they act? remove seat 0 before acting.
    // Action is on 0; disconnect 0 → advance, blinds on 2/1 must not move.
    const before = table.viewFor(ids[1], "BL");
    expect(before.seats[2].isSmallBlind).toBe(true);
    expect(before.seats[1].isBigBlind).toBe(true);

    table.unseatPlayer(ids[0]);
    const after = table.viewFor(ids[1], "BL");
    expect(after.seats[1].isBigBlind).toBe(true);
    expect(after.seats[2].isSmallBlind).toBe(true);
    // Button seat emptied — marker not moved onto another player.
    expect(after.seats[1].isButton).toBe(false);
    expect(after.seats[2].isButton).toBe(false);
  });
});
