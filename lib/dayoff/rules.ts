// [fork] Dienstfrei rules (design 3). Pure: no database.
import type { DayOffErrorCode, DayOffStatus, DayOffTiming } from "@/lib/dayoff/types";
import { MAX_DATES_PER_PROPOSAL, MAX_OPEN_PROPOSALS } from "@/lib/dayoff/types";
import { addDays, fromDayNumber, isoWeekday, mondayOf, toDayNumber } from "@/lib/rotation/dates";
import { counterWindowEnd } from "@/lib/swap/rules";

export type IsOff = (date: string) => boolean;
export interface DayOffState { status: DayOffStatus; date: string | null; standardDate: string | null; dutyDate: string }
export type RuleResult<T> = { ok: true; value: T } | { ok: false; code: DayOffErrorCode };
export interface Revalidated { status: DayOffStatus; date: string | null; standardDate: string; notify: "reset" | null }

const fail = (code: DayOffErrorCode): { ok: false; code: DayOffErrorCode } => ({ ok: false, code });
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const MAX_SEARCH_DAYS = 366;

export function isWeekday(date: string): boolean {
  return isoWeekday(toDayNumber(date)) <= 5;
}

/**
 * Not an Arbeitstag: weekend, Schließtag of the rotation, or another own Dienstfrei.
 * Carries `closedOnly` so checks can tell "notWorkday" from "taken".
 */
export function makeIsOff(closed: ReadonlySet<string>, taken: ReadonlySet<string>): IsOff & { closedOnly: IsOff } {
  const closedOnly: IsOff = (date) => !isWeekday(date) || closed.has(date);
  const fn = ((date: string) => closedOnly(date) || taken.has(date)) as IsOff & { closedOnly: IsOff };
  fn.closedOnly = closedOnly;
  return fn;
}
const closedPart = (isOff: IsOff): IsOff => (isOff as IsOff & { closedOnly?: IsOff }).closedOnly ?? isOff;

/**
 * First Arbeitstag after the duty, across week boundaries (SPEC 12.35). With timing "before"
 * the first Arbeitstag of the duty week before the duty day comes first (SPEC 12.42).
 */
export function standardDate(dutyDate: string, isOff: IsOff, timing: DayOffTiming = "after"): string {
  if (timing === "before") {
    const before = daysBefore(dutyDate).find((d) => !isOff(d));
    if (before) return before;
  }
  for (let i = 1; i <= MAX_SEARCH_DAYS; i++) {
    const date = addDays(dutyDate, i);
    if (!isOff(date)) return date;
  }
  return addDays(dutyDate, 1);
}

export function weekOf(date: string): string[] {
  const monday = fromDayNumber(mondayOf(toDayNumber(date)));
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

/** Mo–Fr of the duty week that lie before the duty day. */
function daysBefore(dutyDate: string): string[] {
  return weekOf(dutyDate).filter((d) => d < dutyDate);
}

/** Days the holder may move a Dienstfrei to: the week before the duty, or the standard day's week after it. */
export function moveRange(row: Pick<DayOffState, "dutyDate" | "standardDate">, timing: DayOffTiming): string[] {
  if (!row.standardDate) return [];
  if (timing === "before" && row.standardDate < row.dutyDate) return daysBefore(row.dutyDate);
  // A weekday duty's week starts before it: only days after the duty count.
  return weekOf(row.standardDate).filter((d) => d > row.dutyDate);
}

/** Why a date can't hold a Dienstfrei, or null. Order: begun, weekend/closed, taken. */
function dateError(date: string, closedOnly: IsOff, isOff: IsOff, today: string): DayOffErrorCode | null {
  if (date <= today) return "alreadyStarted";
  if (closedOnly(date)) return "notWorkday";
  if (isOff(date)) return "taken";
  return null;
}

export function checkMove(row: DayOffState, target: string, isOff: IsOff, today: string, timing: DayOffTiming = "after"): RuleResult<{ status: "standard" | "moved"; date: string }> {
  if (row.status !== "standard" && row.status !== "moved") return fail("wrongStatus");
  if (!row.date || !row.standardDate) return fail("wrongStatus");
  if (row.date <= today) return fail("alreadyStarted");
  if (!moveRange(row, timing).includes(target)) return fail("outsideWeek");
  if (target !== row.date) {
    const error = dateError(target, closedPart(isOff), isOff, today);
    if (error) return fail(error);
  }
  return ok({ status: target === row.standardDate ? "standard" : "moved", date: target });
}

export function checkLock(row: DayOffState, today: string): RuleResult<null> {
  if (row.status !== "standard" && row.status !== "moved" && row.status !== "agreed") return fail("wrongStatus");
  if (row.date && row.date <= today) return fail("alreadyStarted");
  return ok(null);
}

export function checkProposeDates(row: DayOffState, dates: string[], openDates: string[], isOff: IsOff, today: string): RuleResult<string[]> {
  if (row.status !== "locked" && row.status !== "agreed") return fail("wrongStatus");
  // A consumed agreed Dienstfrei is history; it cannot be renegotiated.
  if (row.status === "agreed" && row.date && row.date <= today) return fail("alreadyStarted");
  const unique = [...new Set(dates)].sort();
  if (unique.length === 0) return fail("invalid");
  if (unique.length > MAX_DATES_PER_PROPOSAL || openDates.length + unique.length > MAX_OPEN_PROPOSALS) return fail("tooMany");
  const windowEnd = counterWindowEnd(row.dutyDate);
  for (const date of unique) {
    if (openDates.includes(date) || date === row.date) return fail("duplicate");
    const error = dateError(date, closedPart(isOff), isOff, today);
    if (error) return fail(error);
    if (date > windowEnd) return fail("outsideWindow");
  }
  return ok(unique);
}

export function checkCounter(row: DayOffState, date: string, openDates: string[], isOff: IsOff, today: string): RuleResult<string> {
  if (row.status !== "locked" && row.status !== "agreed") return fail("wrongStatus");
  // A consumed agreed Dienstfrei is history; it cannot be renegotiated.
  if (row.status === "agreed" && row.date && row.date <= today) return fail("alreadyStarted");
  if (openDates.includes(date) || date === row.date) return fail("duplicate");
  const error = dateError(date, closedPart(isOff), isOff, today);
  return error ? fail(error) : ok(date);
}

export function checkAcceptDate(row: DayOffState, date: string, isOff: IsOff, today: string): RuleResult<string> {
  if (row.status !== "locked" && row.status !== "agreed") return fail("wrongStatus");
  // A consumed agreed Dienstfrei is history; it cannot be renegotiated.
  if (row.status === "agreed" && row.date && row.date <= today) return fail("alreadyStarted");
  const error = dateError(date, closedPart(isOff), isOff, today);
  return error ? fail(error) : ok(date);
}

export function transferStatus(status: DayOffStatus): "standard" | "locked" | null {
  if (status === "standard" || status === "moved") return "standard";
  if (status === "locked" || status === "agreed") return "locked";
  return null;
}

/** SPEC 12.38: re-checks a non-frozen row against the current Arbeitstage. */
export function revalidate(row: DayOffState, isOff: IsOff, today: string, timing: DayOffTiming = "after"): Revalidated {
  // A not-yet-taken Dienstfrei is never recomputed onto today or the past.
  const std = standardDate(row.dutyDate, (d) => d <= today || isOff(d), timing);
  const invalid = (date: string | null) => !date || date <= today || isOff(date);
  switch (row.status) {
    case "standard":
      return { status: "standard", date: std, standardDate: std, notify: null };
    case "moved":
      // Outside the range of the current timing (e.g. after switching it): back to standard (SPEC 12.42).
      if (invalid(row.date) || !moveRange({ dutyDate: row.dutyDate, standardDate: std }, timing).includes(row.date!))
        return { status: "standard", date: std, standardDate: std, notify: "reset" };
      // Still valid but now the standard day itself: same day for the holder, so it is standard again.
      if (row.date === std) return { status: "standard", date: std, standardDate: std, notify: null };
      return { status: "moved", date: row.date, standardDate: std, notify: null };
    case "agreed":
      return invalid(row.date) ? { status: "locked", date: null, standardDate: std, notify: "reset" } : { status: "agreed", date: row.date, standardDate: std, notify: null };
    default:
      return { status: row.status, date: row.date, standardDate: std, notify: null };
  }
}

export function isFrozen(row: DayOffState, today: string): boolean {
  if (row.status === "dropped") return true;
  if (row.status === "locked") return false;
  return !!row.date && row.date <= today;
}
