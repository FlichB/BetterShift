// [fork] One calendar entry per Platz (spec 12.32): rendering copies of a duty, titled by the Eintragsvorlage.
// Pure; the copies are display-only and never sent back to the server.
import { entryTitle } from "@/lib/rotation/entry-title";
import type { ShiftWithCalendar } from "@/lib/types";

export interface DutyPlaceIndex {
  /** shiftId → Eintragsvorlage, for duties (not Schließeinträge) only. */
  templates: Map<string, string>;
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
