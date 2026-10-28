// [fork] Urlaub: date helpers and database reads shared by generator input, swap guard, Dienstfrei and validation.
import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { addDays, toDayNumber } from "@/lib/rotation/dates";
import type { Reader } from "@/lib/dayoff/workdays";
import { vacationChanges, vacations } from "@/lib/vacation/schema";
import type { DateRange } from "@/lib/vacation/types";

export type { Reader };

export function rangeDays(range: DateRange): number {
  return toDayNumber(range.to) - toDayNumber(range.from) + 1;
}

export function expandRange(range: DateRange): string[] {
  return Array.from({ length: rangeDays(range) }, (_, i) => addDays(range.from, i));
}

export const overlaps = (a: DateRange, b: DateRange) => a.from <= b.to && b.from <= a.to;

/** Approved vacations per user, sorted by start. */
export function approvedRanges(reader: Reader, userIds: readonly string[]): Map<string, DateRange[]> {
  const result = new Map<string, DateRange[]>();
  if (userIds.length === 0) return result;
  const rows = reader
    .select({ userId: vacations.userId, from: vacations.startDate, to: vacations.endDate })
    .from(vacations)
    .where(and(inArray(vacations.userId, [...userIds]), eq(vacations.status, "approved")))
    .all()
    .sort((a, b) => a.from.localeCompare(b.from));
  for (const r of rows) {
    const list = result.get(r.userId);
    if (list) list.push({ from: r.from, to: r.to });
    else result.set(r.userId, [{ from: r.from, to: r.to }]);
  }
  return result;
}

export function isOnVacation(reader: Reader, userId: string, date: string): boolean {
  return (approvedRanges(reader, [userId]).get(userId) ?? []).some((r) => r.from <= date && date <= r.to);
}

/** Every approved vacation day of the user from `from` on. */
export function vacationDateSet(reader: Reader, userId: string, from: string): Set<string> {
  const rows = reader
    .select({ from: vacations.startDate, to: vacations.endDate })
    .from(vacations)
    .where(and(eq(vacations.userId, userId), eq(vacations.status, "approved"), gte(vacations.endDate, from)))
    .all();
  return new Set(rows.flatMap((r) => expandRange(r).filter((d) => d >= from)));
}

/** Ranges a new or changed vacation of the user must not overlap: pending and approved vacations and open change targets. */
export function blockingRanges(reader: Reader, userId: string, exclude: { vacationId?: string } = {}): DateRange[] {
  const own = reader
    .select({ id: vacations.id, from: vacations.startDate, to: vacations.endDate, status: vacations.status })
    .from(vacations)
    .where(and(eq(vacations.userId, userId), inArray(vacations.status, ["pending", "approved"])))
    .all()
    .filter((r) => r.id !== exclude.vacationId);
  const changes = reader
    .select({ vacationId: vacationChanges.vacationId, from: vacationChanges.startDate, to: vacationChanges.endDate })
    .from(vacationChanges)
    .innerJoin(vacations, eq(vacations.id, vacationChanges.vacationId))
    .where(and(eq(vacations.userId, userId), eq(vacationChanges.status, "pending"), eq(vacationChanges.kind, "change"), ne(vacationChanges.vacationId, exclude.vacationId ?? "")))
    .all();
  return [
    ...own.map(({ from, to }) => ({ from, to })),
    ...changes.filter((c) => c.from && c.to).map((c) => ({ from: c.from!, to: c.to! })),
  ];
}
