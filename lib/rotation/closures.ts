// [fork] Schließtage (spec 2026-10-27 §4.1, §6.1). Pure: no database.
import type { ClosedDate, Holiday, SkipDate } from "@/lib/rotation/types";

/** Fixed fields of every Schließeintrag. */
export const CLOSURE_FIELDS = {
  startTime: "00:00",
  endTime: "23:59",
  color: "#6b7280",
  isAllDay: true,
  notes: null,
} as const;

export function closureTitle(closedTitle: string, reason: string): string {
  return `${closedTitle} (${reason})`;
}

/** Merges Ausfalltage and Feiertage; an Ausfalltag wins over a Feiertag on the same date. */
export function resolveClosedDates(
  skipDates: SkipDate[],
  holidays: Holiday[],
  openDates: string[]
): { closedDates: ClosedDate[]; openHolidays: Holiday[] } {
  const names = new Map<string, string[]>();
  for (const { date, name } of holidays) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const list = names.get(date) ?? [];
    if (!list.includes(trimmed)) list.push(trimmed);
    names.set(date, list);
  }

  const open = new Set(openDates);
  const skipped = new Set(skipDates.map((s) => s.date));
  const closedDates: ClosedDate[] = skipDates.map((s) => ({ date: s.date, reason: s.reason, source: "skip" }));
  const openHolidays: Holiday[] = [];
  for (const [date, list] of names) {
    if (skipped.has(date)) continue;
    const name = list.join(", ");
    if (open.has(date)) openHolidays.push({ date, name });
    else closedDates.push({ date, reason: name, source: "holiday" });
  }

  const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);
  return { closedDates: closedDates.sort(byDate), openHolidays: openHolidays.sort(byDate) };
}
