// [fork] Feiertage from a rotation's Feiertagskalender (spec 2026-10-27 §4.1).
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { shifts } from "@/lib/db/schema";
import { formatDateToLocal, parseLocalDate } from "@/lib/date-utils";
import { rotationDuties } from "@/lib/rotation/schema";
import type { Holiday } from "@/lib/rotation/types";

type Reader = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/** Every shift of the calendar in [from, to] is a Feiertag; generated duties never are. */
export function loadHolidays(reader: Reader, calendarId: string, from: string, to: string): Holiday[] {
  return reader
    .select({ date: shifts.date, title: shifts.title })
    .from(shifts)
    .leftJoin(rotationDuties, eq(rotationDuties.shiftId, shifts.id))
    .where(
      and(
        eq(shifts.calendarId, calendarId),
        gte(shifts.date, parseLocalDate(from)),
        lte(shifts.date, parseLocalDate(to)),
        isNull(rotationDuties.shiftId)
      )
    )
    .all()
    .map((row) => ({ date: formatDateToLocal(row.date), name: row.title }));
}
