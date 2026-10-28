// [fork] Dienstfrei stays with the previous holder on swaps when it lies before the duty (SPEC 12.42).
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { shiftSignups } from "@/lib/db/schema";
import { dayOffProposals, dayOffs } from "@/lib/dayoff/schema";
import { reconcileRotation } from "@/lib/dayoff/service";
import { rotationMembers, rotations } from "@/lib/rotation/schema";
import { acceptOffer, createOffer, forceSwap, waiveCounter } from "@/lib/swap/service";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";

async function setup(excluded: string[] = []) {
  return setupWith(await seedDuties(), excluded);
}

async function setupWith(s: Awaited<ReturnType<typeof seedDuties>>, excluded: string[]) {
  for (const userId of excluded) {
    db.update(rotationMembers).set({ dayOff: false }).where(and(eq(rotationMembers.rotationId, s.rotation.id), eq(rotationMembers.userId, userId))).run();
  }
  db.update(rotations).set({ dayOffEnabled: true, dayOffTiming: "before" }).where(eq(rotations.id, s.rotation.id)).run();
  db.transaction((tx) => reconcileRotation(tx, s.rotation.id, now));
  const of = (date: string, userId: string) =>
    db.select().from(dayOffs).where(and(eq(dayOffs.shiftId, s.duty(date)), eq(dayOffs.userId, userId), ne(dayOffs.status, "dropped"))).get();
  const reconcile = () => db.transaction((tx) => reconcileRotation(tx, s.rotation.id, now));
  const exchange = (date: string, from: string, counter: string, to: string) => {
    const offer = createOffer({ shiftId: s.duty(date), type: "exchange", targetUserId: null, requestedShiftId: s.duty(counter), note: null }, from, now);
    acceptOffer(offer.id, to, null, now);
  };
  return { ...s, of, reconcile, exchange };
}

describe("Dienstfrei before the duty on swaps", () => {
  it("an exchange leaves both Dienstfreie with their holders", async () => {
    const s = await setup();
    s.exchange("2026-11-07", s.m0, "2026-11-14", s.m2);
    expect(s.of("2026-11-07", s.m0)).toMatchObject({ status: "standard", date: "2026-11-02", keptOnSwap: true });
    expect(s.of("2026-11-14", s.m2)).toMatchObject({ status: "standard", date: "2026-11-09", keptOnSwap: true });
    expect(s.of("2026-11-07", s.m2)).toBeUndefined();
    expect(s.of("2026-11-14", s.m0)).toBeUndefined();
    expect(s.reconcile()).toMatchObject({ created: 0, transferred: 0, dropped: 0 });
  });

  it("a forced swap leaves the Einspringer without one, also when the Ausgleich is waived", async () => {
    const s = await setup();
    const forced = forceSwap({ shiftId: s.duty("2026-11-07"), absentUserId: s.m0, substituteUserId: s.m4, note: null }, s.team.ownerId, now);
    expect(s.of("2026-11-07", s.m0)).toMatchObject({ keptOnSwap: true, date: "2026-11-02" });
    expect(s.of("2026-11-07", s.m4)).toBeUndefined();
    waiveCounter(forced.swap.id, "Krankenstand", s.team.ownerId, now);
    expect(s.reconcile()).toMatchObject({ created: 0 });
    expect(s.of("2026-11-07", s.m4)).toBeUndefined();
  });

  it("swapping back clears the mark", async () => {
    const s = await setup();
    s.exchange("2026-11-07", s.m0, "2026-11-14", s.m2);
    s.exchange("2026-11-07", s.m2, "2026-11-14", s.m0);
    expect(s.of("2026-11-07", s.m0)).toMatchObject({ keptOnSwap: false });
    expect(s.of("2026-11-14", s.m2)).toMatchObject({ keptOnSwap: false });
  });

  it("a locked Dienstfrei stays with its holder together with the open proposals", async () => {
    const s = await setup();
    const row = s.of("2026-11-07", s.m0)!;
    db.update(dayOffs).set({ status: "locked", date: null }).where(eq(dayOffs.id, row.id)).run();
    db.insert(dayOffProposals).values({ dayOffId: row.id, date: "2026-11-18", side: "holder", proposedByUserId: s.m0 }).run();
    s.exchange("2026-11-07", s.m0, "2026-11-14", s.m2);
    expect(s.of("2026-11-07", s.m0)).toMatchObject({ id: row.id, status: "locked", keptOnSwap: true });
    expect(db.select().from(dayOffProposals).where(eq(dayOffProposals.dayOffId, row.id)).get()).toMatchObject({ status: "open" });
  });

  it("a receiver gets none even if the giver had none (SPEC 12.40)", async () => {
    const base = await seedDuties();
    const s = await setupWith(base, [base.m2]); // m2 has no Dienstfrei
    expect(s.of("2026-11-14", s.m2)).toBeUndefined();
    s.exchange("2026-11-07", s.m0, "2026-11-14", s.m2);
    expect(s.of("2026-11-07", s.m0)).toMatchObject({ keptOnSwap: true }); // not dropped
    expect(s.of("2026-11-14", s.m0)).toBeUndefined();
    expect(s.reconcile()).toMatchObject({ created: 0 });
  });

  // Manager reassignment = direct signup change + reconcile, the same path the signup routes take.
  it("reassignment hands over an unmarked Dienstfrei, never a marked one", async () => {
    const s = await setup();
    s.exchange("2026-11-07", s.m0, "2026-11-14", s.m2);
    // manager replaces m1 on 11-07 by m5 (no swap → no slot lock)
    db.update(shiftSignups).set({ userId: s.m5 }).where(and(eq(shiftSignups.shiftId, s.duty("2026-11-07")), eq(shiftSignups.userId, s.m1))).run();
    const m1Row = s.of("2026-11-07", s.m1)!;
    s.reconcile();
    expect(s.of("2026-11-07", s.m5)).toMatchObject({ id: m1Row.id, status: "standard" });
    expect(s.of("2026-11-07", s.m0)).toMatchObject({ keptOnSwap: true });
  });

  it("removed seats drop orphans first, then marked rows", async () => {
    const s = await setup();
    s.exchange("2026-11-07", s.m0, "2026-11-14", s.m2);
    const signups = (u: string) => and(eq(shiftSignups.shiftId, s.duty("2026-11-07")), eq(shiftSignups.userId, u));
    db.delete(shiftSignups).where(signups(s.m1)).run();
    s.reconcile();
    expect(s.of("2026-11-07", s.m1)).toBeUndefined(); // orphan dropped (seatRemoved)
    expect(s.of("2026-11-07", s.m0)).toMatchObject({ keptOnSwap: true }); // 1 row, 1 seat (m2)
    db.delete(shiftSignups).where(signups(s.m2)).run();
    s.reconcile();
    expect(s.of("2026-11-07", s.m0)).toBeUndefined(); // 1 row, 0 seats
  });

  it("switching to after clears the marks and the rows follow the Platz again", async () => {
    const s = await setup();
    s.exchange("2026-11-07", s.m0, "2026-11-14", s.m2);
    db.update(rotations).set({ dayOffTiming: "after" }).where(eq(rotations.id, s.rotation.id)).run();
    s.reconcile();
    expect(s.of("2026-11-07", s.m2)).toMatchObject({ status: "standard", date: "2026-11-09", keptOnSwap: false });
    expect(s.of("2026-11-14", s.m0)).toMatchObject({ status: "standard", date: "2026-11-16", keptOnSwap: false });
    expect(s.of("2026-11-07", s.m0)).toBeUndefined();
  });
});
