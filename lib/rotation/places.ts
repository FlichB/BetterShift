// [fork] One calendar entry per Platz (spec 12.32): rendering copies of a duty, titled by the Eintragsvorlage.
// Dienstfreie join them as all-day rendering entries. Pure; the copies are display-only and never sent back to the server.
import { parseLocalDate } from "@/lib/date-utils";
import { entryTitle } from "@/lib/rotation/entry-title";
import type { ShiftWithCalendar } from "@/lib/types";

export const DAY_OFF_COLOR = "#0d9488";

export interface DayOffIndexEntry {
  id: string;
  calendarId: string;
  title: string;
}

export interface DutyPlaceIndex {
  /** shiftId → Eintragsvorlage, for duties (not Schließeinträge) only. */
  templates: Map<string, string>;
  /** date (YYYY-MM-DD) → the Dienstfreie on that day. */
  dayOffs: Map<string, DayOffIndexEntry[]>;
}

export function placeTitles(shift: ShiftWithCalendar, template: string, openLabel: string): { userId: string | null; title: string }[] {
  const holders = (shift.signups ?? []).map((s) => ({ userId: s.id as string | null, title: entryTitle(template, { name: s.name, email: s.email }, shift.title) }));
  const open = Math.max(0, (shift.signupCapacity ?? 0) - holders.length);
  return [...holders, ...Array.from({ length: open }, () => ({ userId: null, title: openLabel }))];
}

export function expandDutyPlaces(shifts: ShiftWithCalendar[], index: DutyPlaceIndex, openLabel: string): ShiftWithCalendar[] {
  return shifts.flatMap((shift) => {
    const template = index.templates.get(shift.id);
    if (!template) return [shift];
    const places = placeTitles(shift, template, openLabel);
    // A duty without holders and capacity would vanish from the grids; keep it as is.
    if (places.length === 0) return [shift];
    let free = 0;
    return places.map(({ userId, title }) => ({
      ...shift,
      id: userId ? `${shift.id}:${userId}` : `${shift.id}:open-${free++}`,
      title,
      signups: [],
      signupCapacity: null,
      dutyPlace: { shiftId: shift.id, userId },
    }));
  });
}

/**
 * Rendering entries for the Dienstfreie on `date`. With a base shift only those of its calendar,
 * which also lends them its calendar object; without one every calendar's.
 */
export function dayOffEntries(date: string, base: ShiftWithCalendar | null, index: DutyPlaceIndex): ShiftWithCalendar[] {
  const entries = (index.dayOffs.get(date) ?? []).filter((d) => !base || d.calendarId === base.calendarId);
  return entries.map((d) => ({
    id: `dayoff:${d.id}`,
    calendarId: d.calendarId,
    calendar: base?.calendar,
    presetId: null,
    date: parseLocalDate(date),
    startTime: "00:00",
    endTime: "23:59",
    title: d.title,
    color: DAY_OFF_COLOR,
    notes: null,
    isAllDay: true,
    syncedFromExternal: false,
    externalSyncId: null,
    signupCapacity: null,
    signups: [],
    dayOff: { id: d.id },
    createdBy: null,
    createdAt: null,
    updatedAt: null,
  }));
}

export type CalendarRef = NonNullable<ShiftWithCalendar["calendar"]>;

/**
 * The Dienstfreie of `calendars` on `dates`, independent of any shift in view: a week without
 * a single shift of the calendar still shows them. Each entry carries its calendar object.
 */
export function dayOffEntriesForDays(dates: string[], calendars: CalendarRef[], index: DutyPlaceIndex): ShiftWithCalendar[] {
  if (calendars.length === 0 || index.dayOffs.size === 0) return [];
  const byId = new Map(calendars.map((c) => [c.id, c]));
  return dates.flatMap((date) =>
    dayOffEntries(date, null, index)
      .filter((entry) => byId.has(entry.calendarId))
      .map((entry) => ({ ...entry, calendar: byId.get(entry.calendarId) }))
  );
}
