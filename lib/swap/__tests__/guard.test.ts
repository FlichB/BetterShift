import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { shifts } from "@/lib/db/schema";
import { parseLocalDate } from "@/lib/date-utils";
import { blocksSelfSignup, isClosedDuty, isRotationDuty } from "@/lib/swap/guard";
import { createRotation, runGeneration } from "@/lib/rotation/service";
import { rotationDuties } from "@/lib/rotation/schema";
import { and, eq } from "drizzle-orm";
import { dutiesOf, loadSlot } from "@/lib/swap/service";
import { seedDuties } from "./fixtures";

let s: Awaited<ReturnType<typeof seedDuties>>;
beforeEach(async () => {
  s = await seedDuties();
});

describe("self-signup guard", () => {
  it("knows duties from plain shifts", () => {
    const plain = db
      .insert(shifts)
      .values({ calendarId: s.team.calendarId, date: parseLocalDate("2026-11-08"), startTime: "10:00", endTime: "12:00", title: "Frei" })
      .returning()
      .get();
    expect(isRotationDuty(s.duty("2026-11-07"))).toBe(true);
    expect(isRotationDuty(plain.id)).toBe(false);
    expect(blocksSelfSignup(plain.id, s.m0, s.m0, { canManageOthers: false })).toBe(false);
  });

  it("blocks self sign-up and withdrawal on duties for plain Teilnehmer", () => {
    expect(blocksSelfSignup(s.duty("2026-11-07"), s.m0, s.m0, { canManageOthers: false })).toBe(true);
  });

  it("lets people who may sign up others reassign by hand", () => {
    expect(blocksSelfSignup(s.duty("2026-11-07"), s.team.ownerId, s.team.ownerId, { canManageOthers: true })).toBe(false);
    expect(blocksSelfSignup(s.duty("2026-11-07"), s.team.ownerId, s.m0, { canManageOthers: true })).toBe(false);
  });
});

describe("Schließeinträge", () => {
  it("are recognised and are no swappable slot", async () => {
    const rotation = createRotation(
      {
        name: "Mit Ausfall",
        calendarId: s.team.calendarId,
        presetId: s.team.presetId,
        memberIds: s.team.memberIds,
        perShift: 2,
        period: "week",
        periodDays: null,
        startDate: "2027-01-04",
        startOffset: 0,
        weekdays: [6],
        skipDates: [{ date: "2027-01-09", reason: "Inventur" }],
        closedTitle: "Geschlossen",
        entryTitle: "{Vorname} Dienst",
        dayOffEnabled: false,
        dayOffTitle: "{Vorname} dienstfrei",
        dayOffTiming: "after",
        dayOffExcludedIds: [],
        yearlyFairness: false,
        reinforcedDates: [],
        holidayCalendarId: null,
        holidayOpenDates: [],
      },
      s.team.ownerId
    );
    await runGeneration(rotation.id, "2027-01-04", "2027-01-10", s.team.ownerId, new Date(2026, 9, 21, 12, 0));
    const closed = db
      .select({ shiftId: rotationDuties.shiftId })
      .from(rotationDuties)
      .where(and(eq(rotationDuties.rotationId, rotation.id), eq(rotationDuties.date, "2027-01-09")))
      .get()!.shiftId;
    expect(isClosedDuty(closed)).toBe(true);
    expect(isClosedDuty(s.duty("2026-11-07"))).toBe(false);
    expect(loadSlot(db, closed)).toBeNull();
  });

  it("never count as a duty in the double-booking check, even with a hand-added Platz", () => {
    const shiftId = s.duty("2026-11-07"); // holders m0, m1
    db.update(rotationDuties).set({ kind: "closed" }).where(eq(rotationDuties.shiftId, shiftId)).run();
    expect(dutiesOf(db, s.m0).map((d) => d.shiftId)).not.toContain(shiftId);
  });
});
