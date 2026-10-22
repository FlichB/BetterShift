import { isValidLocalDate, toDayNumber } from "@/lib/rotation/dates";
import { ROTATION_PERIODS, type RotationPeriod } from "@/lib/rotation/types";

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
  skipDates: string[];
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
  | "range";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RotationValidationError };

export const MAX_RANGE_DAYS = 366;
const MAX_NAME = 100;
const MAX_PER_SHIFT = 20;
const MAX_PERIOD_DAYS = 365;

const fail = (error: RotationValidationError) => ({ ok: false as const, error });
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export function validateRotationInput(body: unknown): ValidationResult<RotationInput> {
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

  const skipDates = b.skipDates ?? [];
  if (!Array.isArray(skipDates) || !skipDates.every((d) => typeof d === "string" && isValidLocalDate(d))) {
    return fail("skipDates");
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
      skipDates: [...new Set(skipDates as string[])].sort(),
    },
  };
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
