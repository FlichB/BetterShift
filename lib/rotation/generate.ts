import { fromDayNumber, isoWeekday, mondayOf, toDayNumber } from "@/lib/rotation/dates";
import type { PlannedDuty, RotationRule } from "@/lib/rotation/types";

function assertRule(rule: RotationRule): void {
  if (!Number.isInteger(rule.perShift) || rule.perShift < 1) {
    throw new RangeError("perShift must be a positive integer");
  }
  if (rule.memberIds.length < rule.perShift) {
    throw new RangeError("A rotation needs at least perShift members");
  }
  if (rule.period === "days" && (!Number.isInteger(rule.periodDays) || (rule.periodDays ?? 0) < 1)) {
    throw new RangeError("period 'days' needs a positive periodDays");
  }
}

function periodIndex(rule: RotationRule, start: number, day: number): number {
  switch (rule.period) {
    case "day":
      return day - start;
    case "week":
      return Math.floor((mondayOf(day) - mondayOf(start)) / 7);
    case "days":
      return Math.floor((day - start) / (rule.periodDays as number));
  }
}

/** Teilnehmer for the n-th duty (0-based), round robin over memberIds. */
export function seatsFor(rule: RotationRule, dutyNumber: number): string[] {
  const n = rule.memberIds.length;
  return Array.from(
    { length: rule.perShift },
    (_, k) => rule.memberIds[(rule.startOffset + dutyNumber * rule.perShift + k) % n]
  );
}

/**
 * Planned duties for every duty day in [from, to] on or after rule.startDate.
 * Duty numbers are counted from startDate so the result for a date never
 * depends on the requested window; a period whose duty days are all
 * Ausfalltage does not consume a number.
 */
export function generateDuties(rule: RotationRule, from: string, to: string): PlannedDuty[] {
  assertRule(rule);
  const start = toDayNumber(rule.startDate);
  const first = Math.max(start, toDayNumber(from));
  const last = toDayNumber(to);
  const skip = new Set(rule.skipDates);
  const weekdays = new Set(rule.weekdays);

  const result: PlannedDuty[] = [];
  let dutyNumber = -1;
  let currentPeriod: number | null = null;

  for (let day = start; day <= last; day++) {
    if (weekdays.size > 0 && !weekdays.has(isoWeekday(day))) continue;
    const date = fromDayNumber(day);
    if (skip.has(date)) continue;

    const period = periodIndex(rule, start, day);
    if (period !== currentPeriod) {
      currentPeriod = period;
      dutyNumber++;
    }
    if (day >= first) result.push({ date, userIds: seatsFor(rule, dutyNumber) });
  }
  return result;
}

/**
 * startOffset for a restart: the Teilnehmer right after the latest position
 * (in the new order) among those who had the last duty before the restart.
 */
export function suggestStartOffset(memberIds: string[], lastDutyUserIds: string[]): number {
  const positions = lastDutyUserIds
    .map((id) => memberIds.indexOf(id))
    .filter((p) => p >= 0);
  if (positions.length === 0 || memberIds.length === 0) return 0;
  return (Math.max(...positions) + 1) % memberIds.length;
}
