// [fork] Mindestbesetzung: loading scopes, vacations and Dienstfreie (SPEC 12.44).
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dayOffs } from "@/lib/dayoff/schema";
import { rotations } from "@/lib/rotation/schema";
import { loadStaffing } from "@/lib/staffing/load";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { vacations } from "@/lib/vacation/schema";

const MON = "2026-11-16";

async function setup(minPresent: number | null) {
  const s = await seedDuties();
  db.update(rotations).set({ minPresent }).where(eq(rotations.id, s.rotation.id)).run();
  const others = s.team.memberIds.slice(2);
  const dayOff = (userId: string, date: string | null, status: "standard" | "moved" | "agreed" | "locked" | "dropped") =>
    db
      .insert(dayOffs)
      .values({ rotationId: s.rotation.id, shiftId: s.duty("2026-11-14"), dutyDate: "2026-11-14", userId, status, date, createdAt: now, updatedAt: now })
      .returning({ id: dayOffs.id })
      .get().id;
  return { ...s, others, dayOff };
}

describe("loadStaffing", () => {
  it("is empty without a rotation that has minPresent", async () => {
    const s = await setup(null);
    s.dayOff(s.m2, MON, "standard");
    expect(loadStaffing(db, [s.m0], "2026-11-01", "2026-12-31").isFull(s.m0)(MON)).toBe(false);
  });

  it("counts dated Dienstfreie and approved vacations of all Teilnehmer", async () => {
    const s = await setup(6); // 8 Teilnehmer: m0 may only be away if at most one other is
    s.dayOff(s.m2, MON, "moved");
    expect(loadStaffing(db, [s.m0], "2026-11-01", "2026-12-31").isFull(s.m0)(MON)).toBe(false);
    db.insert(vacations).values({ userId: s.m3, startDate: MON, endDate: MON, status: "approved", requestedBy: s.m3 }).run();
    expect(loadStaffing(db, [s.m0], "2026-11-01", "2026-12-31").isFull(s.m0)(MON)).toBe(true);
  });

  it("ignores locked, dropped and pending entries", async () => {
    const s = await setup(6);
    s.dayOff(s.m2, MON, "agreed");
    s.dayOff(s.m3, null, "locked");
    s.dayOff(s.m4, MON, "dropped");
    db.insert(vacations).values({ userId: s.m5, startDate: MON, endDate: MON, status: "pending", requestedBy: s.m5 }).run();
    expect(loadStaffing(db, [s.m0], "2026-11-01", "2026-12-31").isFull(s.m0)(MON)).toBe(false);
  });

  it("fixedOnly skips standard Dienstfreie; excludeDayOffIds skips given rows", async () => {
    const s = await setup(6);
    s.dayOff(s.m2, MON, "moved");
    const standard = s.dayOff(s.m3, MON, "standard");
    expect(loadStaffing(db, [s.m0], "2026-11-01", "2026-12-31").isFull(s.m0)(MON)).toBe(true);
    expect(loadStaffing(db, [s.m0], "2026-11-01", "2026-12-31", { fixedOnly: true }).isFull(s.m0)(MON)).toBe(false);
    expect(loadStaffing(db, [s.m0], "2026-11-01", "2026-12-31", { excludeDayOffIds: [standard] }).isFull(s.m0)(MON)).toBe(false);
  });
});
