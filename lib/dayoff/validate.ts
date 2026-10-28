// [fork] Request validators for the Dienstfrei routes.
import { isValidLocalDate } from "@/lib/rotation/dates";
import { MAX_DATES_PER_PROPOSAL } from "@/lib/dayoff/types";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: "invalid" };

const MAX_TEXT = 500;
const invalid = { ok: false, error: "invalid" } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isDate = (v: unknown): v is string => typeof v === "string" && isValidLocalDate(v);

/** undefined/null → null, a short string → trimmed (empty → null), anything else → undefined (invalid) */
function parseText(v: unknown): string | null | undefined {
  if (v == null) return null;
  if (typeof v !== "string") return undefined;
  const text = v.trim();
  return text.length > MAX_TEXT ? undefined : text || null;
}

export function validateDate(body: unknown): ValidationResult<{ date: string }> {
  if (!isRecord(body) || !isDate(body.date)) return invalid;
  return { ok: true, value: { date: body.date } };
}

export function validateDates(body: unknown): ValidationResult<{ dates: string[] }> {
  if (!isRecord(body) || !Array.isArray(body.dates)) return invalid;
  const dates = body.dates;
  if (dates.length < 1 || dates.length > MAX_DATES_PER_PROPOSAL || !dates.every(isDate)) return invalid;
  return { ok: true, value: { dates: dates as string[] } };
}

export function validateLock(body: unknown): ValidationResult<{ note: string | null }> {
  if (body == null) return { ok: true, value: { note: null } };
  if (!isRecord(body)) return invalid;
  const note = parseText(body.note);
  return note === undefined ? invalid : { ok: true, value: { note } };
}

export function validateDecline(body: unknown): ValidationResult<{ reason: string | null }> {
  if (body == null) return { ok: true, value: { reason: null } };
  if (!isRecord(body)) return invalid;
  const reason = parseText(body.reason);
  return reason === undefined ? invalid : { ok: true, value: { reason } };
}
