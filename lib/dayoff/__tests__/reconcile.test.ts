// [fork] Dienstfrei reconcile (design D15–D17).
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { shiftSignups, shifts } from "@/lib/db/schema";
import { dayOffs } from "@/lib/dayoff/schema";
import { reconcileRotation } from "@/lib/dayoff/service";
import { rotationMembers, rotations } from "@/lib/rotation/schema";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { seedHolidays } from "@/tests/helpers/seed";

const enable = (rotationId: string, extra: Partial<typeof rotations.$inferInsert> = {}) =>
  db.update(rotations).set({ dayOffEnabled: true, ...extra }).where(eq(rotations.id, rotationId)).run();
const run = (rotationId: string, at = now) => db.transaction((tx) => reconcileRotation(tx, rotationId, at));
const rowsOf = (shiftId: string) => db.select().from(dayOffs).where(eq(dayOffs.shiftId, shiftId)).all();

describe("reconcileRotation", () => {
  it("does nothing while switched off", async () => {
    const s = await seedDuties();
    run(s.rotation.id);
    expect(db.select().from(dayOffs).all()).toHaveLength(0);
  });

  it("creates one standard Dienstfrei per Platz on the Monday after", async () => {
    const s = await seedDuties();
    enable(s.rotation.id);
    expect(run(s.rotation.id).created).toBe(16);
    const rows = rowsOf(s.duty("2026-11-07"));
    expect(rows.map((r) => [r.userId, r.status, r.date]).sort()).toEqual([[s.m0, "standard", "2026-11-09"], [s.m1, "standard", "2026-11-09"]].sort());
  });

  it("is idempotent", async () => {
    const s = await seedDuties();
    enable(s.rotation.id);
    run(s.rotation.id);
    expect(run(s.rotation.id)).toMatchObject({ created: 0, transferred: 0, dropped: 0, reset: 0 });
  });

  it("moves a standard Dienstfrei off a holiday Monday", async () => {
    const s = await seedDuties();
    const holidayCalendarId = seedHolidays(s.team.ownerId, [{ date: "2026-11-09", title: "Testfeiertag" }]);
    enable(s.rotation.id, { holidayCalendarId });
    run(s.rotation.id);
    expect(rowsOf(s.duty("2026-11-07"))[0].date).toBe("2026-11-10");
  });

  it("uses Ausfalltage on weekdays", async () => {
    const s = await seedDuties();
    enable(s.rotation.id, { skipDates: [{ date: "2026-11-09", reason: "Inventur" }] });
    run(s.rotation.id);
    expect(rowsOf(s.duty("2026-11-07"))[0].date).toBe("2026-11-10");
  });

  it("hands the Dienstfrei to a new holder changed outside the swap board (reset to standard)", async () => {
    const s = await seedDuties();
    enable(s.rotation.id);
    run(s.rotation.id);
    const shiftId = s.duty("2026-11-07");
    db.update(dayOffs).set({ status: "moved", date: "2026-11-11" }).where(and(eq(dayOffs.shiftId, shiftId), eq(dayOffs.userId, s.m0))).run();
    db.update(shiftSignups).set({ userId: s.m5 }).where(and(eq(shiftSignups.shiftId, shiftId), eq(shiftSignups.userId, s.m0))).run();
    expect(run(s.rotation.id).transferred).toBe(1);
    const moved = rowsOf(shiftId).find((r) => r.userId === s.m5)!;
    expect(moved).toMatchObject({ status: "standard", date: "2026-11-09" });
  });

  it("drops the Dienstfreie of a deleted duty and of a switched-off rotation", async () => {
    const s = await seedDuties();
    enable(s.rotation.id);
    run(s.rotation.id);
    const shiftId = s.duty("2026-11-07");
    const ids = rowsOf(shiftId).map((r) => r.id);
    db.delete(shifts).where(eq(shifts.id, shiftId)).run();
    expect(run(s.rotation.id).dropped).toBe(2);
    for (const id of ids) expect(db.select().from(dayOffs).where(eq(dayOffs.id, id)).get()).toMatchObject({ status: "dropped", dropReason: "noDuty" });
    db.update(rotations).set({ dayOffEnabled: false }).where(eq(rotations.id, s.rotation.id)).run();
    expect(run(s.rotation.id).dropped).toBe(14);
  });

  it("never touches a begun Dienstfrei", async () => {
    const s = await seedDuties();
    enable(s.rotation.id);
    run(s.rotation.id);
    const later = new Date(2026, 10, 9, 8, 0); // Mon 2026-11-09
    db.update(rotations).set({ dayOffEnabled: false }).where(eq(rotations.id, s.rotation.id)).run();
    run(s.rotation.id, later);
    expect(rowsOf(s.duty("2026-11-07")).every((r) => r.status === "standard")).toBe(true);
  });

  it("an agreed date that became a holiday turns locked", async () => {
    const s = await seedDuties();
    enable(s.rotation.id);
    run(s.rotation.id);
    const row = rowsOf(s.duty("2026-11-07"))[0];
    db.update(dayOffs).set({ status: "agreed", date: "2026-11-18" }).where(eq(dayOffs.id, row.id)).run();
    db.update(rotations).set({ skipDates: [{ date: "2026-11-18", reason: "Inventur" }] }).where(eq(rotations.id, s.rotation.id)).run();
    expect(run(s.rotation.id).reset).toBe(1);
    expect(db.select().from(dayOffs).where(eq(dayOffs.id, row.id)).get()).toMatchObject({ status: "locked", date: null });
  });

  it("gives a Teilnehmer without Dienstfrei none and drops the active ones they had", async () => {
    const s = await seedDuties();
    enable(s.rotation.id);
    run(s.rotation.id);
    db.update(rotationMembers)
      .set({ dayOff: false })
      .where(and(eq(rotationMembers.rotationId, s.rotation.id), eq(rotationMembers.userId, s.m0)))
      .run();
    // m0 holds 11-07 and 12-12
    const result = run(s.rotation.id);
    expect(result).toMatchObject({ created: 0, dropped: 2 });
    const rows = rowsOf(s.duty("2026-11-07"));
    expect(rows.find((r) => r.userId === s.m0)).toMatchObject({ status: "dropped", dropReason: "excluded" });
    expect(rows.find((r) => r.userId === s.m1)).toMatchObject({ status: "standard", date: "2026-11-09" });
    expect(run(s.rotation.id)).toMatchObject({ created: 0, dropped: 0 });
  });

  it("gives a Platz a Dienstfrei once its holder without one leaves it", async () => {
    const s = await seedDuties();
    db.update(rotationMembers)
      .set({ dayOff: false })
      .where(and(eq(rotationMembers.rotationId, s.rotation.id), eq(rotationMembers.userId, s.m0)))
      .run();
    enable(s.rotation.id);
    expect(run(s.rotation.id).created).toBe(14);
    const shiftId = s.duty("2026-11-07");
    db.update(shiftSignups).set({ userId: s.m5 }).where(and(eq(shiftSignups.shiftId, shiftId), eq(shiftSignups.userId, s.m0))).run();
    expect(run(s.rotation.id).created).toBe(1);
    expect(rowsOf(shiftId).find((r) => r.userId === s.m5)).toMatchObject({ status: "standard", date: "2026-11-09" });
  });
});
