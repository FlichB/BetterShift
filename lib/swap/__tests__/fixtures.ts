// Shared seed for swap tests: 8 Teilnehmer, Samstagsdienst 09:30–15:00, 2 per duty,
// generated for Nov–Dec 2026. Duties: 11-07 [m0,m1], 11-14 [m2,m3], 11-21 [m4,m5],
// 11-28 [m6,m7], then re-paired: 12-05 [m1,m2], 12-12 [m0,m3], 12-19 [m5,m6], 12-26 [m4,m7].
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shiftSignups } from "@/lib/db/schema";
import { createRotation, runGeneration } from "@/lib/rotation/service";
import { rotationDuties, rotationSlotLocks } from "@/lib/rotation/schema";
import { seedTeam } from "@/tests/helpers/seed";

export const now = new Date(2026, 9, 22, 12, 0); // Thu 2026-10-22 12:00

export async function seedDuties() {
  const team = seedTeam();
  const rotation = createRotation(
    {
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
    },
    team.ownerId
  );
  await runGeneration(rotation.id, "2026-11-02", "2026-12-27", team.ownerId, now);

  const duty = (date: string) =>
    db
      .select({ shiftId: rotationDuties.shiftId })
      .from(rotationDuties)
      .where(and(eq(rotationDuties.rotationId, rotation.id), eq(rotationDuties.date, date)))
      .get()!.shiftId;
  const holders = (shiftId: string) =>
    db
      .select({ userId: shiftSignups.userId })
      .from(shiftSignups)
      .where(eq(shiftSignups.shiftId, shiftId))
      .all()
      .map((s) => s.userId)
      .sort();
  const locks = (shiftId: string) =>
    db.select().from(rotationSlotLocks).where(eq(rotationSlotLocks.shiftId, shiftId)).all();
  const [m0, m1, m2, m3, m4, m5] = team.memberIds;
  return { team, rotation, duty, holders, locks, m0, m1, m2, m3, m4, m5 };
}

export const sorted = (...ids: string[]) => [...ids].sort();
