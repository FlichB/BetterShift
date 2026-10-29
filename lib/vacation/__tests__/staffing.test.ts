// [fork] Urlaub: staffing gaps in previews and requests (SPEC 12.44).
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dayOffs } from "@/lib/dayoff/schema";
import { rotations } from "@/lib/rotation/schema";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { previewAction } from "@/lib/vacation/replan";
import { staffingGaps } from "@/lib/vacation/staffing";
import { vacations } from "@/lib/vacation/schema";

const today = "2026-10-22";
const WEEK = { from: "2027-01-11", to: "2027-01-17" }; // Mon … Sun, after the generated plan

async function setup() {
  const s = await seedDuties();
  db.update(rotations).set({ minPresent: 6 }).where(eq(rotations.id, s.rotation.id)).run();
  db.insert(vacations).values({ userId: s.m1, startDate: "2027-01-12", endDate: "2027-01-12", status: "approved", requestedBy: s.m1 }).run();
  return s;
}

describe("staffingGaps", () => {
  it("lists Werktage of the new range below the minimum", async () => {
    const s = await setup();
    db.insert(dayOffs).values({ rotationId: s.rotation.id, shiftId: null, dutyDate: "2027-01-09", userId: s.m2, status: "moved", date: "2027-01-12", createdAt: now, updatedAt: now }).run();
    const gaps = staffingGaps(db, s.m0, [WEEK], WEEK, today);
    expect(gaps).toEqual([{ rotationId: s.rotation.id, rotationName: "Samstagsdienst", date: "2027-01-12", present: 5, minimum: 6 }]);
  });

  it("standard Dienstfreie do not count, they move away", async () => {
    const s = await setup();
    db.insert(dayOffs).values({ rotationId: s.rotation.id, shiftId: null, dutyDate: "2027-01-09", userId: s.m2, status: "standard", date: "2027-01-12", createdAt: now, updatedAt: now }).run();
    expect(staffingGaps(db, s.m0, [WEEK], WEEK, today)).toEqual([]);
  });

  it("nothing for a cancel, nothing without a minimum", async () => {
    const s = await setup();
    expect(staffingGaps(db, s.m0, [], null, today)).toEqual([]);
    db.update(rotations).set({ minPresent: null }).where(eq(rotations.id, s.rotation.id)).run();
    db.insert(vacations).values({ userId: s.m2, startDate: "2027-01-12", endDate: "2027-01-12", status: "approved", requestedBy: s.m2 }).run();
    expect(staffingGaps(db, s.m0, [WEEK], WEEK, today)).toEqual([]);
  });
});

describe("previewAction", () => {
  it("attaches the gaps to the rotation", async () => {
    const s = await setup();
    db.insert(vacations).values({ userId: s.m2, startDate: "2027-01-12", endDate: "2027-01-12", status: "approved", requestedBy: s.m2 }).run();
    const preview = await previewAction({ kind: "enter", userId: s.m0, startDate: WEEK.from, endDate: WEEK.to }, now);
    expect(preview.rotations[0].staffing).toEqual([{ rotationId: s.rotation.id, rotationName: "Samstagsdienst", date: "2027-01-12", present: 5, minimum: 6 }]);
  });
});
