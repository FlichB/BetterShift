// [fork] Urlaub × Mindestbesetzung (SPEC 12.44, design §5): Werktage a vacation would leave understaffed.
import { eq } from "drizzle-orm";
import { addDays } from "@/lib/rotation/dates";
import type { StaffingGap } from "@/lib/staffing/index";
import { loadStaffing } from "@/lib/staffing/load";
import { expandRange, type Reader } from "@/lib/vacation/dates";
import { vacationChanges, vacations } from "@/lib/vacation/schema";
import type { DateRange, VacationAction } from "@/lib/vacation/types";

/** The range a vacation action puts in place, or null when it frees days (cancel). */
export function targetRange(reader: Reader, action: VacationAction): DateRange | null {
  switch (action.kind) {
    case "enter":
    case "change":
      return { from: action.startDate, to: action.endDate };
    case "approve": {
      const v = reader.select().from(vacations).where(eq(vacations.id, action.vacationId)).get();
      return v ? { from: v.startDate, to: v.endDate } : null;
    }
    case "cancel":
      return null;
    case "approveChange": {
      const c = reader.select().from(vacationChanges).where(eq(vacationChanges.id, action.changeId)).get();
      return c && c.kind === "change" && c.startDate && c.endDate ? { from: c.startDate, to: c.endDate } : null;
    }
  }
}

/**
 * Werktage of `target` (from tomorrow) on which a rotation of the person would fall below its
 * Mindestbesetzung, with the person's vacations set to `ranges`. Only fixed Dienstfreie count:
 * standard ones move away from full days (SPEC 12.44).
 */
export function staffingGaps(
  reader: Reader,
  userId: string,
  ranges: readonly DateRange[],
  target: DateRange | null,
  today: string
): StaffingGap[] {
  if (!target) return [];
  const from = target.from > today ? target.from : addDays(today, 1);
  if (from > target.to) return [];
  const index = loadStaffing(reader, [userId], from, target.to, { fixedOnly: true });
  index.setRanges(userId, ranges);
  return index.gapsFor(userId, expandRange({ from, to: target.to }));
}
