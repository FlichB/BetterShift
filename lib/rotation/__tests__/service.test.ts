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
import { seedTeam } from "@/tests/helpers/seed";

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
  };
});

function dutiesOf(rotationId: string) {
  return db
    .select({ date: rotationDuties.date, shiftId: rotationDuties.shiftId })
    .from(rotationDuties)
    .where(eq(rotationDuties.rotationId, rotationId))
    .all()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      shiftId: d.shiftId,
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
    updateRotation(rotation.id, { ...input, skipDates: ["2026-11-14"] });
    const summary = await runGeneration(rotation.id, "2026-11-02", "2026-11-30", team.ownerId, now);
    expect(summary.deleted).toBe(1);
    expect(dutiesOf(rotation.id).map((d) => d.date)).toEqual(["2026-11-07", "2026-11-21", "2026-11-28"]);
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
