import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shiftPresets, shiftSignups, shifts } from "@/lib/db/schema";
import { rotationDuties, rotationSlotLocks } from "@/lib/rotation/schema";
import {
  createRotation,
  deleteRotation,
  previewGeneration,
  runGeneration,
  suggestOffsetFor,
  updateRotation,
  RotationServiceError,
} from "@/lib/rotation/service";
import type { RotationInput } from "@/lib/rotation/validate";
import { seedHolidays, seedTeam } from "@/tests/helpers/seed";

const now = new Date(2026, 9, 21, 12, 0); // 2026-10-21 12:00

let team: ReturnType<typeof seedTeam>;
let input: RotationInput;

beforeEach(() => {
  team = seedTeam();
  input = {
    name: "Samstagsdienst",
    calendarId: team.calendarId,
    presetId: team.presetId,
    memberIds: team.memberIds,
    perShift: 2,
    period: "week",
    periodDays: null,
    startDate: "2026-11-02",
    startOffset: 0,
    weekdays: [6],
    skipDates: [],
    closedTitle: "Geschlossen",
    holidayCalendarId: null,
    holidayOpenDates: [],
    entryTitle: "{Vorname} Dienst",
    reinforcedDates: [],
  };
});

function dutiesOf(rotationId: string) {
  return db
    .select({ date: rotationDuties.date, shiftId: rotationDuties.shiftId, kind: rotationDuties.kind })
    .from(rotationDuties)
    .where(eq(rotationDuties.rotationId, rotationId))
    .all()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      shiftId: d.shiftId,
      kind: d.kind,
      userIds: db
        .select({ userId: shiftSignups.userId })
        .from(shiftSignups)
        .where(eq(shiftSignups.shiftId, d.shiftId))
        .all()
        .map((s) => s.userId)
        .sort(),
    }));
}

describe("rotation service", () => {
  it("generates 12 Saturdays with 2 Plätze each as normal shifts", async () => {
    const rotation = createRotation(input, team.ownerId);
    const summary = await runGeneration(rotation.id, "2026-11-02", "2027-01-24", team.ownerId, now);
    expect(summary).toMatchObject({ created: 12, updated: 0, deleted: 0 });

    const duties = dutiesOf(rotation.id);
    expect(duties).toHaveLength(12);
    expect(duties[0].userIds).toEqual([team.memberIds[0], team.memberIds[1]].sort());
    const shift = db.select().from(shifts).where(eq(shifts.id, duties[0].shiftId)).get()!;
    expect(shift).toMatchObject({ title: "Samstagsdienst", startTime: "09:30", endTime: "15:00", signupCapacity: 2 });
  });

  it("is idempotent", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2027-01-24", team.ownerId, now);
    const again = await runGeneration(rotation.id, "2026-11-02", "2027-01-24", team.ownerId, now);
    expect(again).toMatchObject({ created: 0, updated: 0, deleted: 0, unchanged: 12 });
    expect(db.select().from(shifts).where(eq(shifts.calendarId, team.calendarId)).all()).toHaveLength(12);
  });

  it("preview writes nothing", async () => {
    const rotation = createRotation(input, team.ownerId);
    const plan = await previewGeneration(rotation.id, "2026-11-02", "2026-11-30", now);
    expect(plan.entries.filter((e) => e.kind === "create")).toHaveLength(4);
    expect(dutiesOf(rotation.id)).toHaveLength(0);
  });

  it("keeps locked slots on regeneration", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    const [first] = dutiesOf(rotation.id);
    const [a, , c] = team.memberIds;
    // simulate a phase-2 give-away: a → c on the first Saturday
    db.update(shiftSignups)
      .set({ userId: c })
      .where(and(eq(shiftSignups.shiftId, first.shiftId), eq(shiftSignups.userId, a)))
      .run();
    db.insert(rotationSlotLocks).values({ shiftId: first.shiftId, userId: c, replacesUserId: a }).run();

    const summary = await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    expect(summary.updated).toBe(0);
    expect(dutiesOf(rotation.id)[0].userIds).toEqual([c, team.memberIds[1]].sort());
  });

  it("never changes started duties", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    const later = new Date(2026, 10, 7, 10, 0); // first Saturday is running
    updateRotation(rotation.id, { ...input, startOffset: 4 });
    await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, later);
    expect(dutiesOf(rotation.id)[0].userIds).toEqual([team.memberIds[0], team.memberIds[1]].sort());
    expect(dutiesOf(rotation.id)[1].userIds).toEqual([team.memberIds[6], team.memberIds[7]].sort());
  });

  it("leaves past duties, their Plätze and locks alone when generating from an earlier date", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    const later = new Date(2026, 10, 16, 12, 0); // 11-07 and 11-14 are past
    const before = dutiesOf(rotation.id).filter((d) => d.date <= "2026-11-14");
    const futureBefore = dutiesOf(rotation.id).find((d) => d.date === "2026-11-21")!;
    const [first] = before;
    const lock = { shiftId: first.shiftId, userId: first.userIds[0], replacesUserId: team.memberIds[7] };
    db.insert(rotationSlotLocks).values(lock).run();
    const locksOf = () =>
      db
        .select({ shiftId: rotationSlotLocks.shiftId, userId: rotationSlotLocks.userId, replacesUserId: rotationSlotLocks.replacesUserId })
        .from(rotationSlotLocks)
        .where(eq(rotationSlotLocks.shiftId, first.shiftId))
        .all();
    updateRotation(rotation.id, { ...input, startOffset: 3, skipDates: [{ date: "2026-11-07", reason: "Inventur" }] });
    await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, later);
    expect(dutiesOf(rotation.id).filter((d) => d.date <= "2026-11-14")).toEqual(before);
    expect(locksOf()).toEqual([lock]);
    // the regeneration really ran: a future duty follows the new offset
    const futureAfter = dutiesOf(rotation.id).find((d) => d.date === "2026-11-21")!;
    expect(futureAfter.userIds).not.toEqual(futureBefore.userIds);
  });

  it("restart from X after a Teilnehmer leaves: suggestion continues after the last duty", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-12-31", team.ownerId, now);
    const remaining = team.memberIds.filter((_, i) => i !== 5); // M6 leaves
    const offset = suggestOffsetFor(rotation.id, "2026-11-23", remaining); // last before: 21.11. = M5+M6
    expect(remaining[offset]).toBe(team.memberIds[6]); // M7 is next

    updateRotation(rotation.id, { ...input, memberIds: remaining, startDate: "2026-11-23", startOffset: offset });
    await runGeneration(rotation.id, "2026-11-23", "2026-12-31", team.ownerId, now);
    const duties = dutiesOf(rotation.id);
    expect(duties.find((d) => d.date === "2026-11-21")!.userIds).toEqual(
      [team.memberIds[4], team.memberIds[5]].sort()
    );
    expect(duties.find((d) => d.date === "2026-11-28")!.userIds).toEqual(
      [team.memberIds[6], team.memberIds[7]].sort()
    );
  });

  it("removes duties that became Ausfalltage", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    updateRotation(rotation.id, { ...input, skipDates: [{ date: "2026-11-14", reason: "Inventur" }] });
    const summary = await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    expect(summary.deleted).toBe(1);
    expect(dutiesOf(rotation.id).map((d) => [d.date, d.kind])).toEqual([
      ["2026-11-07", "duty"], ["2026-11-14", "closed"], ["2026-11-21", "duty"], ["2026-11-28", "duty"],
    ]);
  });

  it("syncs capacity when perShift changes", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    updateRotation(rotation.id, { ...input, perShift: 3 });
    const summary = await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    expect(summary.updated).toBe(4);
    for (const d of dutiesOf(rotation.id)) {
      expect(d.userIds).toHaveLength(3);
      expect(db.select().from(shifts).where(eq(shifts.id, d.shiftId)).get()!.signupCapacity).toBe(3);
    }
  });

  it("re-syncs presetId when the rotation switches to an identical preset", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    const secondPreset = crypto.randomUUID();
    db.insert(shiftPresets)
      .values({
        id: secondPreset,
        calendarId: team.calendarId,
        title: "Samstagsdienst",
        startTime: "09:30",
        endTime: "15:00",
        color: "#3b82f6",
      })
      .run();
    updateRotation(rotation.id, { ...input, presetId: secondPreset });
    const summary = await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    expect(summary.updated).toBe(4);
    for (const d of dutiesOf(rotation.id)) {
      expect(db.select().from(shifts).where(eq(shifts.id, d.shiftId)).get()!.presetId).toBe(secondPreset);
    }
  });

  it("fails cleanly when the preset is archived", async () => {
    const rotation = createRotation(input, team.ownerId);
    db.update(shiftPresets).set({ archivedAt: new Date() }).where(eq(shiftPresets.id, team.presetId)).run();
    await expect(runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now)).rejects.toEqual(
      new RotationServiceError("presetArchived")
    );
  });

  it("deleting a rotation can remove its future duties", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    expect(deleteRotation(rotation.id, { deleteFutureDuties: true }, now)).toEqual({ deletedDuties: 4 });
    expect(db.select().from(shifts).where(eq(shifts.calendarId, team.calendarId)).all()).toHaveLength(0);
  });

  it("copies the preset notes into generated shifts", async () => {
    db.update(shiftPresets).set({ notes: "Schlüssel bei Chef" }).where(eq(shiftPresets.id, team.presetId)).run();
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-08", team.ownerId, now);
    const [duty] = dutiesOf(rotation.id);
    const shift = db.select().from(shifts).where(eq(shifts.id, duty.shiftId)).get()!;
    expect(shift.notes).toBe("Schlüssel bei Chef");
  });
});

describe("Schließtage", () => {
  const titleOf = (shiftId: string) => db.select().from(shifts).where(eq(shifts.id, shiftId)).get()!;

  it("writes a Schließeintrag for an Ausfalltag and moves the pair on", async () => {
    const rotation = createRotation(
      { ...input, closedTitle: "HeimkinoWelt geschlossen", skipDates: [{ date: "2026-11-14", reason: "Inventur" }] },
      team.ownerId
    );
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    const days = dutiesOf(rotation.id);
    expect(days.map((d) => [d.date, d.kind])).toEqual([
      ["2026-11-07", "duty"], ["2026-11-14", "closed"], ["2026-11-21", "duty"], ["2026-11-28", "duty"],
    ]);
    expect(days[1].userIds).toEqual([]);
    expect(titleOf(days[1].shiftId)).toMatchObject({
      title: "HeimkinoWelt geschlossen (Inventur)", isAllDay: true, startTime: "00:00", endTime: "23:59",
      color: "#6b7280", presetId: null, signupCapacity: 0,
    });
    expect(days[2].userIds).toEqual([team.memberIds[2], team.memberIds[3]].sort());
  });

  it("reads Feiertage from the Feiertagskalender and honours Geöffnete Feiertage", async () => {
    const holidays = seedHolidays(team.ownerId, [
      { date: "2026-11-14", title: "Testfeiertag" },
      { date: "2026-11-18", title: "Mittwochsfeiertag" },
      { date: "2026-11-21", title: "Offener Feiertag" },
    ]);
    const rotation = createRotation({ ...input, holidayCalendarId: holidays, holidayOpenDates: ["2026-11-21"] }, team.ownerId);
    const plan = await previewGeneration(rotation.id, "2026-11-02", "2026-11-28", now);
    expect(plan.closures).toEqual([{ kind: "create", date: "2026-11-14", title: "Geschlossen (Testfeiertag)", source: "holiday" }]);
    expect(plan.openHolidays).toEqual([{ date: "2026-11-21", name: "Offener Feiertag" }]);
    expect(plan.entries.map((e) => e.date)).toEqual(["2026-11-07", "2026-11-21", "2026-11-28"]);
  });

  it("swaps duty and Schließeintrag on the same date in both directions", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    updateRotation(rotation.id, { ...input, skipDates: [{ date: "2026-11-14", reason: "Inventur" }] });
    const closing = await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    expect(closing).toMatchObject({ created: 1, deleted: 1 });
    expect(dutiesOf(rotation.id).find((d) => d.date === "2026-11-14")!.kind).toBe("closed");

    updateRotation(rotation.id, input);
    const reopening = await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    expect(reopening).toMatchObject({ created: 1, deleted: 1 });
    expect(dutiesOf(rotation.id).find((d) => d.date === "2026-11-14")!.kind).toBe("duty");
  });

  it("is idempotent with Schließeinträge", async () => {
    const rotation = createRotation({ ...input, skipDates: [{ date: "2026-11-14", reason: "Inventur" }] }, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    expect(await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now)).toMatchObject({
      created: 0, updated: 0, deleted: 0, unchanged: 4,
    });
  });

  it("keeps a duty with a locked Platz and writes no Schließeintrag there", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    const sat = dutiesOf(rotation.id).find((d) => d.date === "2026-11-14")!;
    db.insert(rotationSlotLocks).values({ shiftId: sat.shiftId, userId: sat.userIds[0] }).run();
    updateRotation(rotation.id, { ...input, skipDates: [{ date: "2026-11-14", reason: "Inventur" }] });
    const plan = await previewGeneration(rotation.id, "2026-11-02", "2026-11-28", now);
    expect(plan.warnings.map((w) => w.kind)).toEqual(["lockedWithoutDuty"]);
    expect(plan.closures).toEqual([]);
  });

  it("never reads the rotation's own shifts as Feiertage", async () => {
    const holidays = seedHolidays(team.ownerId, []);
    const rotation = createRotation({ ...input, holidayCalendarId: holidays }, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    // Move one generated duty into the holiday calendar: it must still not count as a Feiertag.
    const moved = dutiesOf(rotation.id)[0];
    db.update(shifts).set({ calendarId: holidays }).where(eq(shifts.id, moved.shiftId)).run();
    const plan = await previewGeneration(rotation.id, "2026-11-02", "2026-11-28", now);
    expect(plan.closures).toEqual([]);
  });

  it("deletes future Schließeinträge with the rotation", async () => {
    const rotation = createRotation({ ...input, skipDates: [{ date: "2026-11-14", reason: "Inventur" }] }, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    const closure = dutiesOf(rotation.id).find((d) => d.kind === "closed")!;
    // 3 duties + 1 Schließeintrag; only the duties are counted.
    expect(deleteRotation(rotation.id, { deleteFutureDuties: true }, now)).toEqual({ deletedDuties: 3 });
    expect(db.select().from(shifts).where(eq(shifts.id, closure.shiftId)).get()).toBeUndefined();
  });

  it("keeps a past Feiertag counting after it left the Feiertagskalender", async () => {
    const holidays = seedHolidays(team.ownerId, [{ date: "2026-11-14", title: "Testfeiertag" }]);
    const rotation = createRotation({ ...input, holidayCalendarId: holidays }, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2027-01-24", team.ownerId, now);
    const before = dutiesOf(rotation.id);
    const later = new Date(2026, 10, 20, 12, 0); // 11-14 is past
    // The external sync drops old events: the Feiertag is gone from the calendar.
    db.delete(shifts).where(eq(shifts.calendarId, holidays)).run();
    const summary = await runGeneration(rotation.id, "2026-11-02", "2027-01-24", team.ownerId, later);
    expect(summary).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(dutiesOf(rotation.id)).toEqual(before);
  });

  it("unlinking the Feiertagskalender keeps past Schließtage counting and drops future ones", async () => {
    const holidays = seedHolidays(team.ownerId, [
      { date: "2026-11-14", title: "Testfeiertag" },
      { date: "2026-12-05", title: "Späterer Feiertag" },
    ]);
    const rotation = createRotation({ ...input, holidayCalendarId: holidays }, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-12-31", team.ownerId, now);
    const before = dutiesOf(rotation.id);
    const later = new Date(2026, 10, 20, 12, 0);
    updateRotation(rotation.id, { ...input, holidayCalendarId: null });
    await runGeneration(rotation.id, "2026-11-02", "2026-12-31", team.ownerId, later);
    const after = dutiesOf(rotation.id);
    const on = (list: typeof after, date: string) => list.find((d) => d.date === date)!;
    expect(on(after, "2026-11-14").kind).toBe("closed");
    for (const date of ["2026-11-21", "2026-11-28"]) expect(on(after, date)).toEqual(on(before, date));
    expect(on(after, "2026-12-05")).toMatchObject({ kind: "duty" });
    expect(on(after, "2026-12-05").userIds).toHaveLength(2);
  });

  it("a begun day keeps its Schließeintrag when the closure is lifted (no duty created, no crash)", async () => {
    const rotation = createRotation({ ...input, skipDates: [{ date: "2026-11-14", reason: "Inventur" }] }, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    const morning = new Date(2026, 10, 14, 8, 0); // closure has begun, duty start 09:30 not yet
    updateRotation(rotation.id, input);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, morning);
    expect(dutiesOf(rotation.id).find((d) => d.date === "2026-11-14")!.kind).toBe("closed");
  });

  it("a begun day keeps its duty when it becomes closed before the duty starts (no gap)", async () => {
    const rotation = createRotation(input, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    const before = dutiesOf(rotation.id).find((d) => d.date === "2026-11-14")!;
    const morning = new Date(2026, 10, 14, 8, 0);
    updateRotation(rotation.id, { ...input, skipDates: [{ date: "2026-11-14", reason: "Inventur" }] });
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, morning);
    expect(dutiesOf(rotation.id).find((d) => d.date === "2026-11-14")).toEqual(before);
  });

  it("ignores Schließeinträge when suggesting a restart offset", async () => {
    const rotation = createRotation({ ...input, skipDates: [{ date: "2026-11-14", reason: "Inventur" }] }, team.ownerId);
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    // Last entry before 2026-11-15 is the closure; the suggestion must look at the duty of 2026-11-07 (M1, M2).
    expect(suggestOffsetFor(rotation.id, "2026-11-15", team.memberIds)).toBe(2);
  });
});

it("writes the capacity of a verstärkter Tag into the duty", async () => {
  const rotation = createRotation({ ...input, reinforcedDates: [{ date: "2026-11-14", perShift: 3 }] }, team.ownerId);
  await runGeneration(rotation.id, "2026-11-07", "2026-11-21", team.ownerId, now);
  const capacities = db
    .select({ date: rotationDuties.date, capacity: shifts.signupCapacity })
    .from(rotationDuties)
    .innerJoin(shifts, eq(shifts.id, rotationDuties.shiftId))
    .where(eq(rotationDuties.rotationId, rotation.id))
    .all()
    .sort((a, b) => a.date.localeCompare(b.date));
  expect(capacities).toEqual([
    { date: "2026-11-07", capacity: 2 },
    { date: "2026-11-14", capacity: 3 },
    { date: "2026-11-21", capacity: 2 },
  ]);
});
