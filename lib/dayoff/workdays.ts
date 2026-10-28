// [fork] Dienstfrei: Arbeitstage inputs read from the database (design 3, SPEC 12.35).
import { and, eq, isNotNull, ne } from "drizzle-orm";
import type { db } from "@/lib/db";
import { dayOffs } from "@/lib/dayoff/schema";
import { resolveClosedDates } from "@/lib/rotation/closures";
import { loadHolidays } from "@/lib/rotation/holidays";
import { vacationDateSet } from "@/lib/vacation/dates"; // [fork]
import type { Rotation } from "@/lib/rotation/schema";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Reader = Tx | typeof db;

/** Schließtage of the rotation in [from, to]: Ausfalltage plus Feiertage that are not opened. */
export function loadClosedSet(reader: Reader, rotation: Rotation, from: string, to: string): Set<string> {
  const holidays = rotation.holidayCalendarId ? loadHolidays(reader, rotation.holidayCalendarId, from, to) : [];
  const { closedDates } = resolveClosedDates(rotation.skipDates, holidays, rotation.holidayOpenDates);
  return new Set(closedDates.map((c) => c.date));
}

/** Dates of the user's other Dienstfreie (any rotation) that hold a date and are not dropped, plus their approved vacation days. */
export function takenDates(reader: Reader, userId: string, excludeId: string | null): Set<string> {
  const rows = reader
    .select({ id: dayOffs.id, date: dayOffs.date })
    .from(dayOffs)
    .where(and(eq(dayOffs.userId, userId), isNotNull(dayOffs.date), ne(dayOffs.status, "dropped")))
    .all();
  const taken = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.date!));
  // [fork] Urlaub (SPEC 12.43): approved vacation days are no Arbeitstage either.
  for (const date of vacationDateSet(reader, userId, "0000-01-01")) taken.add(date);
  return taken;
}
