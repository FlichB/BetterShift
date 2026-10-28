// [fork] Dienstfrei with a Mindestbesetzung (SPEC 12.44).
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { shiftSignups } from "@/lib/db/schema";
import { dayOffs } from "@/lib/dayoff/schema";
import { acceptProposal, counterPropose, lockDayOff, moveDayOff, moveOptions, proposeDates, reconcileRotation } from "@/lib/dayoff/service";
import { createRotation, runGeneration } from "@/lib/rotation/service";
import { rotationDuties, rotations } from "@/lib/rotation/schema";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { vacations } from "@/lib/vacation/schema";
import { seedTeam } from "@/tests/helpers/seed";

async function setup(minPresent: number | null) {
  const s = await seedDuties();
  db.update(rotations).set({ dayOffEnabled: true, minPresent }).where(eq(rotations.id, s.rotation.id)).run();
  const reconcile = () => db.transaction((tx) => reconcileRotation(tx, s.rotation.id, now));
  reconcile();
  const of = (date: string, userId: string) =>
    db.select().from(dayOffs).where(and(eq(dayOffs.shiftId, s.duty(date)), eq(dayOffs.userId, userId))).get()!;
  return { ...s, of, reconcile };
}

describe("Abgleich with Mindestbesetzung", () => {
  it("without a minimum both Dienstfreie stay on Monday", async () => {
    const s = await setup(null);
    expect([s.of("2026-11-07", s.m0).date, s.of("2026-11-07", s.m1).date]).toEqual(["2026-11-09", "2026-11-09"]);
  });

  it("with 7 of 8 present the second Dienstfrei of the duty moves to Tuesday", async () => {
    const s = await setup(7);
    const dates = [s.of("2026-11-07", s.m0), s.of("2026-11-07", s.m1)].map((r) => r.date).sort();
    expect(dates).toEqual(["2026-11-09", "2026-11-10"]);
    const both = [s.of("2026-11-07", s.m0), s.of("2026-11-07", s.m1)];
    expect(both.every((r) => r.status === "standard" && r.standardDate === "2026-11-09")).toBe(true);
  });

  it("is stable when run again", async () => {
    const s = await setup(7);
    const before = [s.of("2026-11-07", s.m0).date, s.of("2026-11-07", s.m1).date];
    s.reconcile();
    expect([s.of("2026-11-07", s.m0).date, s.of("2026-11-07", s.m1).date]).toEqual(before);
  });

  it("a later approved vacation pushes a standard Dienstfrei off the day, a moved one stays", async () => {
    const s = await setup(6);
    const moved = s.of("2026-11-14", s.m2);
    moveDayOff(moved.id, "2026-11-18", s.m2, now);
    db.insert(vacations).values({ userId: s.m4, startDate: "2026-11-16", endDate: "2026-11-16", status: "approved", requestedBy: s.m4 }).run();
    db.insert(vacations).values({ userId: s.m5, startDate: "2026-11-16", endDate: "2026-11-16", status: "approved", requestedBy: s.m5 }).run();
    s.reconcile();
    expect(s.of("2026-11-14", s.m2)).toMatchObject({ status: "moved", date: "2026-11-18" });
    expect(s.of("2026-11-14", s.m3)).toMatchObject({ status: "standard", date: "2026-11-17" }); // Monday full: m4, m5 away
  });

  it("the earlier duty picks its day first, regardless of the user ids", async () => {
    // 4 Teilnehmer, minimum 3: only one may be away per Werktag. Fri 11-06 and Sat 11-07 both have Monday 11-09
    // as Standardtag. The later duty's holder has the smaller user id, so a user-first order would give them Monday.
    const team = seedTeam({ members: 4 });
    const rotation = createRotation(
      {
        name: "Wochenenddienst",
        calendarId: team.calendarId,
        presetId: team.presetId,
        memberIds: team.memberIds,
        perShift: 1,
        period: "day",
        periodDays: null,
        startDate: "2026-11-02",
        startOffset: 0,
        weekdays: [5, 6],
        skipDates: [],
        closedTitle: "Geschlossen",
        entryTitle: "{Vorname} Dienst",
        dayOffEnabled: false,
        dayOffTitle: "{Vorname} dienstfrei",
        dayOffTiming: "after",
        dayOffExcludedIds: [],
        yearlyFairness: false,
        minPresent: null,
        reinforcedDates: [],
        holidayCalendarId: null,
        holidayOpenDates: [],
      },
      team.ownerId
    );
    await runGeneration(rotation.id, "2026-11-02", "2026-11-08", team.ownerId, now);
    const duty = (date: string) =>
      db.select().from(rotationDuties).where(and(eq(rotationDuties.rotationId, rotation.id), eq(rotationDuties.date, date))).get()!.shiftId;
    const [lo, hi] = [...team.memberIds].sort();
    const seat = (date: string, userId: string) => {
      db.delete(shiftSignups).where(eq(shiftSignups.shiftId, duty(date))).run();
      db.insert(shiftSignups).values({ shiftId: duty(date), userId, signedUpBy: team.ownerId }).run();
    };
    seat("2026-11-06", hi);
    seat("2026-11-07", lo);
    db.update(rotations).set({ dayOffEnabled: true, minPresent: 3 }).where(eq(rotations.id, rotation.id)).run();
    db.transaction((tx) => reconcileRotation(tx, rotation.id, now));
    const of = (date: string, userId: string) =>
      db.select().from(dayOffs).where(and(eq(dayOffs.shiftId, duty(date)), eq(dayOffs.userId, userId))).get()!;
    expect(of("2026-11-06", hi)).toMatchObject({ status: "standard", date: "2026-11-09", standardDate: "2026-11-09" });
    expect(of("2026-11-07", lo)).toMatchObject({ status: "standard", date: "2026-11-10", standardDate: "2026-11-09" });
  });
});

describe("actions with Mindestbesetzung", () => {
  it("holder cannot move to a full day; the options mark it", async () => {
    const s = await setup(7);
    const tuesday = [s.of("2026-11-07", s.m0), s.of("2026-11-07", s.m1)].find((r) => r.date === "2026-11-10")!;
    expect(() => moveDayOff(tuesday.id, "2026-11-09", tuesday.userId, now)).toThrow(
      expect.objectContaining({ code: "belowMinimum", detail: { date: "2026-11-09", present: 6, minimum: 7 } })
    );
    const opts = moveOptions(tuesday.id, now);
    expect(opts.find((o) => o.date === "2026-11-09")).toMatchObject({ full: true });
    expect(opts.find((o) => o.date === "2026-11-10")).toMatchObject({ full: false, isCurrent: true });
  });

  it("holder proposals on a full day fail", async () => {
    const s = await setup(7);
    const row = s.of("2026-11-07", s.m0);
    lockDayOff(row.id, null, s.team.ownerId, now);
    const fullDay = s.of("2026-11-07", s.m1).date!;
    expect(() => proposeDates(row.id, [fullDay], s.m0, now)).toThrow(expect.objectContaining({ code: "belowMinimum" }));
  });

  it("manager counter needs override on a full day; holder accepts without check", async () => {
    const s = await setup(7);
    const row = s.of("2026-11-07", s.m0);
    lockDayOff(row.id, null, s.team.ownerId, now);
    const fullDay = s.of("2026-11-07", s.m1).date!;
    expect(() => counterPropose(row.id, fullDay, s.team.ownerId, now)).toThrow(expect.objectContaining({ code: "belowMinimum" }));
    const counter = counterPropose(row.id, fullDay, s.team.ownerId, now, true);
    expect(acceptProposal(counter.id, s.m0, false, now)).toMatchObject({ status: "agreed", date: fullDay });
  });

  it("manager accepting a holder proposal on a day that became full needs override", async () => {
    const s = await setup(6);
    const row = s.of("2026-11-07", s.m0);
    lockDayOff(row.id, null, s.team.ownerId, now);
    const [p] = proposeDates(row.id, ["2026-11-18"], s.m0, now);
    db.insert(vacations).values({ userId: s.m4, startDate: "2026-11-18", endDate: "2026-11-18", status: "approved", requestedBy: s.m4 }).run();
    db.insert(vacations).values({ userId: s.m5, startDate: "2026-11-18", endDate: "2026-11-18", status: "approved", requestedBy: s.m5 }).run();
    expect(() => acceptProposal(p.id, s.team.ownerId, true, now)).toThrow(expect.objectContaining({ code: "belowMinimum" }));
    expect(acceptProposal(p.id, s.team.ownerId, true, now, true)).toMatchObject({ status: "agreed", date: "2026-11-18" });
  });
});
