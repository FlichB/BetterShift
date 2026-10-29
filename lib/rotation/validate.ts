import { ENTRY_TITLE_DEFAULT, validateEntryTitle } from "@/lib/rotation/entry-title";
import { DEFAULT_DAY_OFF_TITLE, type DayOffTiming } from "@/lib/dayoff/types"; // [fork] Dienstfrei
import { formatDateToLocal } from "@/lib/date-utils";
import { isValidLocalDate, toDayNumber } from "@/lib/rotation/dates";
import { MAX_YEAR_DELTA } from "@/lib/rotation/yearly"; // [fork] Jahresausgleich
import { ROTATION_PERIODS, type ReinforcedDate, type RotationPeriod, type SkipDate } from "@/lib/rotation/types";

export interface RotationInput {
  name: string;
  calendarId: string;
  presetId: string;
  memberIds: string[];
  perShift: number;
  period: RotationPeriod;
  periodDays: number | null;
  startDate: string;
  startOffset: number;
  weekdays: number[];
  skipDates: SkipDate[];
  closedTitle: string;
  holidayCalendarId: string | null;
  holidayOpenDates: string[];
  entryTitle: string;
  reinforcedDates: ReinforcedDate[];
  // [fork] Dienstfrei (SPEC 12.34)
  dayOffEnabled: boolean;
  dayOffTitle: string;
  dayOffTiming: DayOffTiming; // [fork] SPEC 12.42
  /** Teilnehmer who get no Dienstfrei, e.g. on an all-in contract (SPEC 12.40). */
  dayOffExcludedIds: string[];
  /** [fork] Jahresausgleich (SPEC 12.41). */
  yearlyFairness: boolean;
  minPresent: number | null; // [fork] Mindestbesetzung
}

export type RotationValidationError =
  | "name"
  | "calendarId"
  | "presetId"
  | "members"
  | "perShift"
  | "period"
  | "periodDays"
  | "startDate"
  | "startOffset"
  | "weekdays"
  | "skipDates"
  | "closedTitle"
  | "holidayCalendar"
  | "holidayOpenDates"
  | "entryTitle"
  | "reinforcedDates"
  | "dayOffEnabled"
  | "dayOffTitle"
  | "dayOffTiming"
  | "dayOffExcluded"
  | "yearlyFairness"
  | "minPresent"
  | "yearDelta"
  | "range";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RotationValidationError };

export const MAX_RANGE_DAYS = 366;
const MAX_NAME = 100;
const MAX_PER_SHIFT = 20;
const MAX_PERIOD_DAYS = 365;
const MAX_REASON = 100;
const DEFAULT_CLOSED_TITLE = "Geschlossen"; // same as the closed_title column default

const fail = (error: RotationValidationError) => ({ ok: false as const, error });
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export function validateRotationInput(body: unknown, today: string = formatDateToLocal(new Date())): ValidationResult<RotationInput> {
  if (typeof body !== "object" || body === null) return fail("name");
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.name) || b.name.trim().length > MAX_NAME) return fail("name");
  if (!isNonEmptyString(b.calendarId)) return fail("calendarId");
  if (!isNonEmptyString(b.presetId)) return fail("presetId");
  if (!isInt(b.perShift) || b.perShift < 1 || b.perShift > MAX_PER_SHIFT) return fail("perShift");

  const memberIds = b.memberIds;
  if (
    !Array.isArray(memberIds) ||
    !memberIds.every(isNonEmptyString) ||
    new Set(memberIds).size !== memberIds.length ||
    memberIds.length < b.perShift
  ) {
    return fail("members");
  }

  if (typeof b.period !== "string" || !(ROTATION_PERIODS as readonly string[]).includes(b.period)) {
    return fail("period");
  }
  const period = b.period as RotationPeriod;
  let periodDays: number | null = null;
  if (period === "days") {
    if (!isInt(b.periodDays) || b.periodDays < 1 || b.periodDays > MAX_PERIOD_DAYS) return fail("periodDays");
    periodDays = b.periodDays;
  }

  if (typeof b.startDate !== "string" || !isValidLocalDate(b.startDate)) return fail("startDate");

  const startOffset = b.startOffset ?? 0;
  if (!isInt(startOffset) || startOffset < 0 || startOffset >= memberIds.length) return fail("startOffset");

  const weekdays = b.weekdays ?? [];
  if (
    !Array.isArray(weekdays) ||
    !weekdays.every((d) => isInt(d) && d >= 1 && d <= 7) ||
    new Set(weekdays).size !== weekdays.length
  ) {
    return fail("weekdays");
  }

  const rawSkips = b.skipDates ?? [];
  if (!Array.isArray(rawSkips)) return fail("skipDates");
  const skipByDate = new Map<string, string>();
  for (const entry of rawSkips) {
    if (typeof entry !== "object" || entry === null) return fail("skipDates");
    const { date, reason } = entry as Record<string, unknown>;
    if (typeof date !== "string" || !isValidLocalDate(date)) return fail("skipDates");
    if (!isNonEmptyString(reason) || reason.trim().length > MAX_REASON) return fail("skipDates");
    skipByDate.set(date, reason.trim()); // the last entry for a date wins
  }

  const closedTitle = b.closedTitle ?? DEFAULT_CLOSED_TITLE;
  if (!isNonEmptyString(closedTitle) || closedTitle.trim().length > MAX_NAME) return fail("closedTitle");

  const holidayCalendarId = b.holidayCalendarId ?? null;
  if (holidayCalendarId !== null && !isNonEmptyString(holidayCalendarId)) return fail("holidayCalendar");

  const holidayOpenDates = b.holidayOpenDates ?? [];
  if (!Array.isArray(holidayOpenDates) || !holidayOpenDates.every((d) => typeof d === "string" && isValidLocalDate(d))) {
    return fail("holidayOpenDates");
  }

  const entryTitle = b.entryTitle ?? ENTRY_TITLE_DEFAULT;
  if (typeof entryTitle !== "string" || validateEntryTitle(entryTitle) !== "ok") return fail("entryTitle");

  // [fork] Dienstfrei: off unless switched on; its title template follows the entryTitle rules.
  const dayOffEnabled = b.dayOffEnabled ?? false;
  if (typeof dayOffEnabled !== "boolean") return fail("dayOffEnabled");
  const dayOffTitle = b.dayOffTitle ?? DEFAULT_DAY_OFF_TITLE;
  if (typeof dayOffTitle !== "string" || validateEntryTitle(dayOffTitle) !== "ok") return fail("dayOffTitle");
  const dayOffTiming = b.dayOffTiming ?? "after"; // [fork] SPEC 12.42
  if (dayOffTiming !== "after" && dayOffTiming !== "before") return fail("dayOffTiming");
  const dayOffExcludedIds = b.dayOffExcludedIds ?? [];
  if (!Array.isArray(dayOffExcludedIds) || !dayOffExcludedIds.every((id) => typeof id === "string" && memberIds.includes(id))) {
    return fail("dayOffExcluded");
  }
  // [fork] Jahresausgleich: off unless switched on, so API callers keep today's plan.
  const yearlyFairness = b.yearlyFairness ?? false;
  if (typeof yearlyFairness !== "boolean") return fail("yearlyFairness");
  // [fork] Mindestbesetzung: off unless set; at least one Teilnehmer must be able to be away.
  const minPresent = b.minPresent ?? null;
  if (minPresent !== null && (!isInt(minPresent) || minPresent < 1 || minPresent > memberIds.length - 1)) return fail("minPresent");

  // Past entries are kept untouched: the plan is counted from startDate, so dropping one would
  // shift the future Besetzung. Only future entries must fit the current rotation.
  const rawReinforced = b.reinforcedDates ?? [];
  if (!Array.isArray(rawReinforced)) return fail("reinforcedDates");
  const reinforcedByDate = new Map<string, number>();
  for (const entry of rawReinforced) {
    if (typeof entry !== "object" || entry === null) return fail("reinforcedDates");
    const { date, perShift: size } = entry as Record<string, unknown>;
    if (typeof date !== "string" || !isValidLocalDate(date) || reinforcedByDate.has(date)) return fail("reinforcedDates");
    if (!isInt(size) || size < 1 || size > MAX_PER_SHIFT) return fail("reinforcedDates");
    if (date >= today && (size <= b.perShift || size > memberIds.length)) return fail("reinforcedDates");
    reinforcedByDate.set(date, size);
  }

  return {
    ok: true,
    value: {
      name: b.name.trim(),
      calendarId: b.calendarId,
      presetId: b.presetId,
      memberIds: memberIds as string[],
      perShift: b.perShift,
      period,
      periodDays,
      startDate: b.startDate,
      startOffset,
      weekdays: [...(weekdays as number[])].sort((x, y) => x - y),
      skipDates: [...skipByDate].map(([date, reason]) => ({ date, reason })).sort((x, y) => x.date.localeCompare(y.date)),
      closedTitle: closedTitle.trim(),
      holidayCalendarId,
      holidayOpenDates: [...new Set(holidayOpenDates as string[])].sort(),
      entryTitle: entryTitle.trim(),
      reinforcedDates: [...reinforcedByDate].map(([date, perShift]) => ({ date, perShift })).sort((x, y) => x.date.localeCompare(y.date)),
      dayOffEnabled, // [fork] Dienstfrei
      dayOffTitle: dayOffTitle.trim(), // [fork] Dienstfrei
      dayOffTiming, // [fork] Dienstfrei
      dayOffExcludedIds: [...new Set(dayOffExcludedIds as string[])], // [fork] Dienstfrei
      yearlyFairness, // [fork] Jahresausgleich
      minPresent, // [fork] Mindestbesetzung
    },
  };
}

/**
 * On update, verstärkte Tage before today are frozen: the plan is counted from startDate, so
 * adding, changing or removing a past entry would reshuffle every later Platz.
 */
export function checkPastReinforcedDates(
  stored: ReinforcedDate[],
  next: ReinforcedDate[],
  today: string = formatDateToLocal(new Date())
): RotationValidationError | null {
  const key = (list: ReinforcedDate[]) =>
    list
      .filter((d) => d.date < today)
      .map((d) => `${d.date}=${d.perShift}`)
      .sort()
      .join(",");
  return key(stored) === key(next) ? null : "reinforcedDates";
}

export function validateRange(body: unknown): ValidationResult<{ from: string; to: string }> {
  if (typeof body !== "object" || body === null) return fail("range");
  const { from, to } = body as Record<string, unknown>;
  if (typeof from !== "string" || typeof to !== "string") return fail("range");
  if (!isValidLocalDate(from) || !isValidLocalDate(to)) return fail("range");
  const span = toDayNumber(to) - toDayNumber(from);
  if (span < 0 || span > MAX_RANGE_DAYS) return fail("range");
  return { ok: true, value: { from, to } };
}

/** [fork] Jahresausgleich (SPEC 12.41): a manager's Delta for one Teilnehmer and year; null removes it. */
export function validateYearDeltaOverride(body: unknown): ValidationResult<{ year: number; userId: string; delta: number | null }> {
  if (typeof body !== "object" || body === null) return fail("yearDelta");
  const { year, userId, delta } = body as Record<string, unknown>;
  if (!isInt(year) || year < 2000 || year > 2100) return fail("yearDelta");
  if (!isNonEmptyString(userId)) return fail("yearDelta");
  if (delta !== null && (!isInt(delta) || delta < 0 || delta > MAX_YEAR_DELTA)) return fail("yearDelta");
  return { ok: true, value: { year, userId, delta } };
}
