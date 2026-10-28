// [fork] One calendar entry per Platz (spec 12.32): rendering copies of a duty, titled by the Eintragsvorlage.
// Dienstfreie and Urlaube join them as all-day rendering entries. Pure; the copies are display-only and never sent back to the server.
import { parseLocalDate } from "@/lib/date-utils";
import { entryTitle } from "@/lib/rotation/entry-title";
import { addDays } from "@/lib/rotation/dates"; // [fork]
import { firstNameOf } from "@/lib/vacation/title"; // [fork]
import type { ShiftWithCalendar } from "@/lib/types";
import type { CalendarSwapState } from "@/lib/swap/types"; // [fork]

export const DAY_OFF_COLOR = "#0d9488";
export const VACATION_COLOR = "#7c3aed"; // [fork] Urlaub

export interface DayOffIndexEntry {
  id: string;
  calendarId: string;
  title: string;
  kind?: "vacation"; // [fork] Urlaub
}

export interface DutyPlaceIndex {
  /** shiftId → Eintragsvorlage, for duties (not Schließeinträge) only. */
  templates: Map<string, string>;
  /** date (YYYY-MM-DD) → the Dienstfreie and Urlaube on that day. */
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
 * Rendering entries for the Dienstfreie and Urlaube on `date`. With a base shift only those of its calendar,
 * which also lends them its calendar object; without one every calendar's.
 */
export function dayOffEntries(date: string, base: ShiftWithCalendar | null, index: DutyPlaceIndex): ShiftWithCalendar[] {
  const entries = (index.dayOffs.get(date) ?? []).filter((d) => !base || d.calendarId === base.calendarId);
    return entries.map((d) => {
      const vacation = d.kind === "vacation"; // [fork] Urlaub: own colour and marker, no dayOff
      return {
      id: vacation ? `vacation:${d.id}:${date}` : `dayoff:${d.id}`,
      calendarId: d.calendarId,
      calendar: base?.calendar,
      presetId: null,
      date: parseLocalDate(date),
      startTime: "00:00",
      endTime: "23:59",
      title: d.title,
      color: vacation ? VACATION_COLOR : DAY_OFF_COLOR,
      notes: null,
      isAllDay: true,
      syncedFromExternal: false,
      externalSyncId: null,
      signupCapacity: null,
      signups: [],
      ...(vacation ? { vacation: { id: d.id } } : { dayOff: { id: d.id } }),
    createdBy: null,
    createdAt: null,
    updatedAt: null,
    };
  });
}

export type CalendarRef = NonNullable<ShiftWithCalendar["calendar"]>;

/**
 * The Dienstfreie and Urlaube of `calendars` on `dates`, independent of any shift in view: a week without
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

/** [fork] Urlaub: the index entries of vacations, one per day of each range, keyed by date. */
export function vacationIndexEntries(
  vacations: Pick<CalendarSwapState["vacations"][number], "id" | "startDate" | "endDate" | "name" | "email">[],
  calendarId: string,
  titleOf: (firstName: string) => string
): Map<string, DayOffIndexEntry[]> {
  const map = new Map<string, DayOffIndexEntry[]>();
  for (const v of vacations) {
    const title = titleOf(firstNameOf({ name: v.name, email: v.email }));
    for (let date = v.startDate; date <= v.endDate; date = addDays(date, 1)) {
      const entry: DayOffIndexEntry = { id: v.id, calendarId, title, kind: "vacation" };
      const list = map.get(date);
      if (list) list.push(entry);
      else map.set(date, [entry]);
    }
  }
  return map;
}
