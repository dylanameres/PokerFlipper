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
  const playerIds = Array.from({ length: n }, (_, i) => `p${i}`);
  for (let i = 0; i < n; i++) {
    const r = table.seatPlayer(ids[i], playerIds[i]);
    expect(r.ok).toBe(true);
  }
  return { table, ids, playerIds, getViews: () => views };
}

describe("PokerTable multiplayer framework", () => {
  it("allows up to MAX seats and rejects the next join", () => {
    const { table } = seatedTable(MAX_ONLINE_PLAYERS);
    const full = table.seatPlayer("overflow", "p-overflow");
    expect(full.ok).toBe(false);
    if (!full.ok) {
      expect(full.message).toMatch(/full/i);
    }
  });

  it("seats three distinct playerIds on three different chairs", () => {
    const table = new PokerTable(() => {});
    const a = table.seatPlayer("c-a", "player-a");
    const b = table.seatPlayer("c-b", "player-b");
    const c = table.seatPlayer("c-c", "player-c");
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(new Set([a.seat, b.seat, c.seat]).size).toBe(3);
    expect(table.seatedCount()).toBe(3);
    expect(table.viewFor("c-c", "3").seatedCount).toBe(3);
    // Same playerId reclaims instead of taking a 4th chair.
    const again = table.seatPlayer("c-a2", "player-a");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.seat).toBe(a.seat);
    expect(table.seatedCount()).toBe(3);
  });

  it("deals with MIN players even when seats remain empty", () => {
    const { table, ids } = seatedTable(MIN_ONLINE_PLAYERS);
    expect(table.readyToDeal()).toBe(true);
    table.handle({ type: "hello", gameType: "holdem", playerId: "p0" }, ids[0]);
    table.handle({ type: "deal_hands" }, ids[0]);

    const v0 = table.viewFor(ids[0], "TEST");
    const v1 = table.viewFor(ids[1], "TEST");
    expect(v0.protocol).toBe(ROOM_PROTOCOL);
    expect(v0.maxSeats).toBe(MAX_ONLINE_PLAYERS);
    expect(v0.seatedCount).toBe(2);
    expect(v0.street).toBe("holes");
    expect(v0.yourHoles.every((c) => c !== null)).toBe(true);
    expect(v1.yourHoles.every((c) => c !== null)).toBe(true);
    expect(v0.yourHoles).not.toEqual(v1.yourHoles);

    const empty = v0.seats.filter((s) => !s.filled);
    expect(empty.length).toBe(MAX_ONLINE_PLAYERS - 2);
  });

  it("posts HU blinds with dealer as BB and left seat as SB", () => {
    const { table, ids } = seatedTable(2);
    table.handle({ type: "deal_hands" }, ids[0]);
    const v = table.viewFor(ids[0], "HU");
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
    table.seats[0].connectionId = "a";
    table.seats[0].playerId = "pa";
    table.seats[2].connectionId = "b";
    table.seats[2].playerId = "pb";
    table.hostPlayerId = "pa";
    expect(table.filledSeats()).toEqual([0, 2]);

    table.handle({ type: "deal_hands" }, "a");
    const v = table.viewFor("a", "GAP");
    expect(v.seats[0].isButton).toBe(true);
    expect(v.seats[2].isSmallBlind).toBe(true);
    expect(v.seats[0].isBigBlind).toBe(true);
    expect(v.seats[1].filled).toBe(false);
  });

  it("hides opponent holes until river showdown (per-seat + HU helpers)", () => {
    const { table, ids } = seatedTable(2);
    table.handle({ type: "deal_hands" }, ids[0]);
    const v = table.viewFor(ids[0], "PRIV");
    const opp = v.seats[1];
    expect(opp.holeHidden?.every(Boolean)).toBe(true);
    expect(opp.holes).toBeUndefined();
    expect(v.opponentHidden?.every(Boolean)).toBe(true);
  });

  it("supports a 3-player deal and private hole views", () => {
    const { table, ids } = seatedTable(3);
    table.handle({ type: "deal_hands" }, ids[0]);
    const views = ids.map((id) => table.viewFor(id, "3P"));
    expect(views[0].seatedCount).toBe(3);
    expect(views[0].pot).toBe(SMALL_BLIND + BIG_BLIND);
    for (let i = 0; i < 3; i++) {
      expect(views[i].yourSeat).toBe(i);
      expect(views[i].yourHoles.every((c) => c !== null)).toBe(true);
      for (let j = 0; j < 3; j++) {
        if (j === i) continue;
        expect(views[i].seats[j].holes).toBeUndefined();
        expect(views[i].seats[j].holeHidden?.every(Boolean)).toBe(true);
      }
    }
    expect(views[0].opponentHidden).toBeUndefined();
  });

  it("starts HU preflop action on the SB (non-button)", () => {
    const { table, ids } = seatedTable(2);
    table.handle({ type: "deal_hands" }, ids[0]);
    const v = table.viewFor(ids[0], "ACT");
    expect(v.actionSeat).toBe(1);
    expect(v.canAct).toBe(false);
    expect(table.viewFor(ids[1], "ACT").canAct).toBe(true);
  });

  it("walks 3-handed preflop action left from the BB", () => {
    const { table, ids } = seatedTable(3);
    table.handle({ type: "deal_hands" }, ids[0]);
    const v = table.viewFor(ids[0], "3ACT");
    expect(v.seats[0].isButton).toBe(true);
    expect(v.seats[2].isSmallBlind).toBe(true);
    expect(v.seats[1].isBigBlind).toBe(true);
    expect(v.actionSeat).toBe(0);
    table.handle({ type: "call" }, ids[0]);
    expect(table.viewFor(ids[0], "3ACT").actionSeat).toBe(2);
    table.handle({ type: "call" }, ids[2]);
    expect(table.viewFor(ids[0], "3ACT").actionSeat).toBe(1);
  });

  it("sits late joiners out of the current hand with a clean seat", () => {
    const { table, ids } = seatedTable(2);
    table.handle({ type: "deal_hands" }, ids[0]);
    const holesBefore = table.viewFor(ids[0], "X").yourHoles.slice();

    const joined = table.seatPlayer("late", "p-late");
    expect(joined.ok).toBe(true);
    const late = table.viewFor("late", "X");
    expect(late.seats[late.yourSeat!].inHand).toBe(false);
    expect(late.yourHoles.every((c) => c === null)).toBe(true);
    expect(late.canAct).toBe(false);
    expect(late.status).toMatch(/sitting out/i);
    expect(table.viewFor(ids[0], "X").yourHoles).toEqual(holesBefore);
    expect(() => table.handle({ type: "call" }, "late")).toThrow(/sitting out/i);
  });

  it("reserves the seat and awards pot when opponent disconnects mid-hand", () => {
    const { table, ids } = seatedTable(2);
    table.handle({ type: "deal_hands" }, ids[0]);
    const before = table.viewFor(ids[0], "DC");
    const hostChips = before.seats[0].chips;
    const pot = before.pot;

    table.unseatPlayer(ids[1]);
    const after = table.viewFor(ids[0], "DC");
    expect(after.handOver).toBe(true);
    expect(after.winnerSeats).toEqual([0]);
    expect(after.seats[0].chips).toBe(hostChips + pot);
    // Seat reserved for browser reclaim.
    expect(after.seats[1].filled).toBe(true);
    expect(after.seats[1].connected).toBe(false);
  });

  it("reclaims the same seat and stack by playerId after disconnect", () => {
    const { table, ids, playerIds } = seatedTable(2);
    table.handle({ type: "deal_hands" }, ids[0]);
    // Finish hand via disconnect so stacks are settled.
    table.unseatPlayer(ids[1]);
    const reservedChips = table.viewFor(ids[0], "R").seats[1].chips;

    const reclaimed = table.seatPlayer("c1-reconnect", playerIds[1]);
    expect(reclaimed.ok).toBe(true);
    if (!reclaimed.ok) return;
    expect(reclaimed.reclaimed).toBe(true);
    expect(reclaimed.seat).toBe(1);
    const v = table.viewFor("c1-reconnect", "R");
    expect(v.yourSeat).toBe(1);
    expect(v.seats[1].connected).toBe(true);
    expect(v.seats[1].chips).toBe(reservedChips);
  });

  it("keeps a disconnected seat reserved without leaking holes to a new joiner", () => {
    const { table, ids, playerIds } = seatedTable(3);
    table.handle({ type: "deal_hands" }, ids[0]);
    const victimHoles = table.viewFor(ids[2], "L").yourHoles.slice();

    table.unseatPlayer(ids[2]);
    const reserved = table.viewFor(ids[0], "L");
    expect(reserved.seats[2].filled).toBe(true);
    expect(reserved.seats[2].connected).toBe(false);

    // New browser takes the next empty chair (seat 3), not the reserved one.
    const joined = table.seatPlayer("newbie", "p-new");
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.seat).toBe(3);
    const newbie = table.viewFor("newbie", "L");
    expect(newbie.yourHoles.every((c) => c === null)).toBe(true);
    expect(newbie.yourHoles).not.toEqual(victimHoles);
    // Original player can still reclaim seat 2.
    const back = table.seatPlayer("c2-back", playerIds[2]);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.seat).toBe(2);
    expect(back.reclaimed).toBe(true);
  });

  it("recycles a disconnected folded seat when the table is full", () => {
    const { table, ids } = seatedTable(MAX_ONLINE_PLAYERS);
    table.handle({ type: "deal_hands" }, ids[0]);
    table.unseatPlayer(ids[5]);
    expect(table.viewFor(ids[0], "FULL").seats[5].connected).toBe(false);

    const joined = table.seatPlayer("newbie", "p-new");
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.seat).toBe(5);
    expect(joined.reclaimed).toBe(false);
    const newbie = table.viewFor("newbie", "FULL");
    expect(newbie.yourHoles.every((c) => c === null)).toBe(true);
    expect(newbie.seats[5].inHand).toBe(false);
    expect(newbie.seats[5].chips).toBe(STARTING_CHIPS);
  });

  it("keeps deal-time blind markers after a third player disconnects", () => {
    const { table, ids } = seatedTable(3);
    table.handle({ type: "deal_hands" }, ids[0]);
    const before = table.viewFor(ids[1], "BL");
    expect(before.seats[2].isSmallBlind).toBe(true);
    expect(before.seats[1].isBigBlind).toBe(true);

    table.unseatPlayer(ids[0]);
    const after = table.viewFor(ids[1], "BL");
    expect(after.seats[1].isBigBlind).toBe(true);
    expect(after.seats[2].isSmallBlind).toBe(true);
    // Button seat stays reserved — marker does not jump.
    expect(after.seats[0].filled).toBe(true);
    expect(after.seats[0].isButton).toBe(true);
    expect(after.seats[1].isButton).toBe(false);
    expect(after.seats[2].isButton).toBe(false);
  });

  it("exposes side-pot layers while a short stack is all-in", () => {
    const { table, ids } = seatedTable(3);
    // Short stack on seat 0 (button/BB after deal).
    table.seats[0].chips = 100;
    table.seats[1].chips = 500;
    table.seats[2].chips = 500;
    table.handle({ type: "deal_hands" }, ids[0]);
    // Seat0 is BB with 50 left; UTG action is seat 0 — shove remaining.
    expect(table.viewFor(ids[0], "SP").actionSeat).toBe(0);
    table.handle({ type: "bet", amount: 100 }, ids[0]); // all-in to 100
    // SB (2) calls 100, BB (1) calls 100.
    table.handle({ type: "call" }, ids[2]);
    table.handle({ type: "call" }, ids[1]);
    const v = table.viewFor(ids[0], "SP");
    // Main 300 (100×3) + no side yet if all matched 100.
    expect(v.pot).toBe(300);
    // Equal contributions → single pot (pots omitted).
    expect(v.pots).toBeUndefined();

    // Create a true side pot: reset via new deal with uneven stacks postflop-style
    // by injecting contributions on a fresh street.
    table.seats[0].contributed = 50;
    table.seats[1].contributed = 100;
    table.seats[2].contributed = 100;
    table.seats[0].folded = false;
    table.seats[1].folded = false;
    table.seats[2].folded = false;
    table.seats[0].inHand = true;
    table.seats[1].inHand = true;
    table.seats[2].inHand = true;
    table.pot = 250;
    const layered = table.viewFor(ids[0], "SP2");
    expect(layered.pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 100, eligible: [1, 2] },
    ]);
  });
});
