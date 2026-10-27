import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars, shiftPresets } from "@/lib/db/schema";
import { canViewCalendar } from "@/lib/auth/permissions";
import type { RotationInput } from "@/lib/rotation/validate";

/** Checks that need the database; returns an error code for rotation.errors.<code> or null. */
export async function checkRotationReferences(input: RotationInput, actorId: string | undefined): Promise<string | null> {
  const calendar = db.select().from(calendars).where(eq(calendars.id, input.calendarId)).get();
  if (!calendar) return "calendarId";
  if (!calendar.signupsEnabled) return "signupsDisabled";
  const preset = db
    .select()
    .from(shiftPresets)
    .where(
      and(
        eq(shiftPresets.id, input.presetId),
        eq(shiftPresets.calendarId, input.calendarId),
        isNull(shiftPresets.archivedAt)
      )
    )
    .get();
  if (!preset) return "presetId";
  for (const memberId of input.memberIds) {
    if (!(await canViewCalendar(memberId, input.calendarId))) return "members";
  }
  if (input.holidayCalendarId !== null) {
    if (input.holidayCalendarId === input.calendarId) return "holidayCalendarSame";
    const holidays = db.select({ id: calendars.id }).from(calendars).where(eq(calendars.id, input.holidayCalendarId)).get();
    if (!holidays || !(await canViewCalendar(actorId, input.holidayCalendarId))) return "holidayCalendar";
  }
  return null;
}

export function calendarNameOf(calendarId: string): string {
  return db.select({ name: calendars.name }).from(calendars).where(eq(calendars.id, calendarId)).get()?.name ?? "";
}
