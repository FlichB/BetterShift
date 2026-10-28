// [fork] Dienstfrei tables (design 2).
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { calendarPermissionBundles, shifts } from "@/lib/db/schema";
import { dayOffProposals, dayOffs } from "@/lib/dayoff/schema";
import { canMoveOwnDayOff } from "@/lib/dayoff/permissions";
import { rotations } from "@/lib/rotation/schema";
import { defaultBundleDefinitionsForNewCalendar } from "@/lib/permission-bundles";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";

describe("dayoff schema", () => {
  it("stores a Dienstfrei with a proposal and keeps it when its duty is deleted", async () => {
    const s = await seedDuties();
    const shiftId = s.duty("2026-11-07");
    const row = db
      .insert(dayOffs)
      .values({ rotationId: s.rotation.id, shiftId, dutyDate: "2026-11-07", userId: s.m0, status: "standard", standardDate: "2026-11-09", date: "2026-11-09" })
      .returning()
      .get();
    db.insert(dayOffProposals).values({ dayOffId: row.id, date: "2026-11-11", side: "holder", proposedByUserId: s.m0, status: "open" }).run();
    db.delete(shifts).where(eq(shifts.id, shiftId)).run();
    const after = db.select().from(dayOffs).where(eq(dayOffs.id, row.id)).get();
    expect(after).toMatchObject({ shiftId: null, status: "standard", dutyDate: "2026-11-07" });
    expect(db.select().from(dayOffProposals).where(eq(dayOffProposals.dayOffId, row.id)).all()).toHaveLength(1);
    void now;
  });

  it("defaults the rotation settings", async () => {
    const s = await seedDuties();
    const r = db.select().from(rotations).where(eq(rotations.id, s.rotation.id)).get()!;
    expect(r).toMatchObject({ dayOffEnabled: false, dayOffTitle: "{Vorname} dienstfrei" });
  });

  it("defaults dayOffTiming to after and keptOnSwap to false", async () => {
    const s = await seedDuties();
    const r = db.select().from(rotations).where(eq(rotations.id, s.rotation.id)).get()!;
    expect(r.dayOffTiming).toBe("after");
    const row = db
      .insert(dayOffs)
      .values({ rotationId: s.rotation.id, shiftId: s.duty("2026-11-07"), dutyDate: "2026-11-07", userId: s.m0, status: "standard", standardDate: "2026-11-09", date: "2026-11-09" })
      .returning()
      .get();
    expect(row.keptOnSwap).toBe(false);
  });

  it("puts moveOwnDayOff into every default bundle", () => {
    for (const bundle of defaultBundleDefinitionsForNewCalendar()) expect(bundle.capabilities).toContain("moveOwnDayOff");
  });

  it("lets shared members move, but not unknown users", async () => {
    const s = await seedDuties();
    expect(await canMoveOwnDayOff(s.m0, s.team.calendarId)).toBe(true);
    expect(await canMoveOwnDayOff(s.team.ownerId, s.team.calendarId)).toBe(true);
    const bundles = db.select().from(calendarPermissionBundles).where(eq(calendarPermissionBundles.calendarId, s.team.calendarId)).all();
    for (const b of bundles) {
      db.update(calendarPermissionBundles).set({ capabilities: b.capabilities.filter((c) => c !== "moveOwnDayOff") }).where(eq(calendarPermissionBundles.id, b.id)).run();
    }
    expect(await canMoveOwnDayOff(s.m0, s.team.calendarId)).toBe(false);
  });
});
