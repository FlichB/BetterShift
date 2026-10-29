// [fork] Dienstfrei request validators and the move permission for non-members.
import { describe, expect, it } from "vitest";
import { canMoveOwnDayOff } from "@/lib/dayoff/permissions";
import { validateCounter, validateDate, validateDates, validateDecline, validateLock, validateOverride } from "@/lib/dayoff/validate";
import { seedDuties } from "@/lib/swap/__tests__/fixtures";

describe("dayoff validators", () => {
  it("validateDate needs a real local date", () => {
    expect(validateDate({ date: "2026-11-10" })).toEqual({ ok: true, value: { date: "2026-11-10" } });
    expect(validateDate({ date: "2026-02-30" }).ok).toBe(false);
    expect(validateDate({ date: 5 }).ok).toBe(false);
    expect(validateDate(undefined).ok).toBe(false);
  });

  it("validateDates takes 1 to 5 valid dates", () => {
    expect(validateDates({ dates: ["2026-11-10"] }).ok).toBe(true);
    expect(validateDates({ dates: [] }).ok).toBe(false);
    const six = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16"];
    expect(validateDates({ dates: six.slice(0, 5) }).ok).toBe(true);
    expect(validateDates({ dates: six }).ok).toBe(false);
    expect(validateDates({ dates: ["2026-11-10", "nope"] }).ok).toBe(false);
    expect(validateDates({}).ok).toBe(false);
  });

  it("validateLock trims the note and caps it at 500", () => {
    expect(validateLock(undefined)).toEqual({ ok: true, value: { note: null } });
    expect(validateLock({ note: "  Messe  " })).toEqual({ ok: true, value: { note: "Messe" } });
    expect(validateLock({ note: "   " })).toEqual({ ok: true, value: { note: null } });
    expect(validateLock({ note: "x".repeat(500) }).ok).toBe(true);
    expect(validateLock({ note: "x".repeat(501) }).ok).toBe(false);
    expect(validateLock({ note: 3 }).ok).toBe(false);
  });

  it("validateDecline trims the reason, blank becomes null, caps at 500", () => {
    expect(validateDecline({ reason: "  " })).toEqual({ ok: true, value: { reason: null } });
    expect(validateDecline({})).toEqual({ ok: true, value: { reason: null } });
    expect(validateDecline({ reason: " zu knapp " })).toEqual({ ok: true, value: { reason: "zu knapp" } });
    expect(validateDecline({ reason: "x".repeat(501) }).ok).toBe(false);
  });
});

describe("canMoveOwnDayOff", () => {
  it("is false for a user who is not a member of the calendar", async () => {
    const s = await seedDuties();
    expect(await canMoveOwnDayOff("not-a-member", s.team.calendarId)).toBe(false);
  });
});

describe("override bodies (SPEC 12.44)", () => {
  it("counter: date with optional override", () => {
    expect(validateCounter({ date: "2026-11-18" })).toEqual({ ok: true, value: { date: "2026-11-18", override: false } });
    expect(validateCounter({ date: "2026-11-18", override: true })).toEqual({ ok: true, value: { date: "2026-11-18", override: true } });
    expect(validateCounter({ date: "2026-11-18", override: "yes" })).toEqual({ ok: false, error: "invalid" });
  });
  it("accept: empty body or override flag", () => {
    expect(validateOverride(undefined)).toEqual({ ok: true, value: { override: false } });
    expect(validateOverride({ override: true })).toEqual({ ok: true, value: { override: true } });
    expect(validateOverride({ override: 1 })).toEqual({ ok: false, error: "invalid" });
  });
});
