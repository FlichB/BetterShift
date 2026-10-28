// [fork] Urlaub: request body parsing and pure rule checks (SPEC 12.43 points 1, 5).
import { MAX_NOTE_LENGTH, MAX_VACATION_DAYS, type DateRange, type VacationErrorCode } from "@/lib/vacation/types";
import { overlaps, rangeDays } from "@/lib/vacation/dates";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: VacationErrorCode };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

export function parseNote(value: unknown, required: boolean): Parsed<string | null> {
  if (value !== undefined && value !== null && typeof value !== "string") return { ok: false, error: "invalid" };
  const note = typeof value === "string" ? value.trim() : "";
  if (note.length > MAX_NOTE_LENGTH) return { ok: false, error: "invalid" };
  if (required && note.length === 0) return { ok: false, error: "reasonRequired" };
  return { ok: true, value: note.length > 0 ? note : null };
}

export function parseRangeBody(body: unknown): Parsed<{ startDate: string; endDate: string; note: string | null }> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid" };
  const { startDate, endDate, note } = body as Record<string, unknown>;
  if (!isDate(startDate) || !isDate(endDate) || startDate > endDate) return { ok: false, error: "invalid" };
  const parsedNote = parseNote(note, false);
  if (!parsedNote.ok) return parsedNote;
  return { ok: true, value: { startDate, endDate, note: parsedNote.value } };
}

function shapeError(range: DateRange, blocking: DateRange[]): VacationErrorCode | null {
  if (rangeDays(range) > MAX_VACATION_DAYS) return "tooLong";
  if (blocking.some((b) => overlaps(b, range))) return "overlap";
  return null;
}

export function checkNewRange(range: DateRange, today: string, blocking: DateRange[]): VacationErrorCode | null {
  if (range.from <= today) return "begun";
  return shapeError(range, blocking);
}

/** Begun days are immutable: a running vacation keeps its start and ends today at the earliest. */
export function checkChange(current: DateRange, next: DateRange, today: string, blocking: DateRange[]): VacationErrorCode | null {
  if (current.to < today) return "begun";
  if (current.from <= today) {
    if (next.from !== current.from || next.to < today) return "begun";
  } else if (next.from <= today) {
    return "begun";
  }
  return shapeError(next, blocking);
}

export function checkCancel(current: DateRange, today: string): VacationErrorCode | null {
  return current.from <= today ? "begun" : null;
}
