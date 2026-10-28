// [fork] Urlaub: pure validation (SPEC 12.43 points 1, 5).
import { describe, expect, it } from "vitest";
import { expandRange, rangeDays } from "@/lib/vacation/dates";
import { checkCancel, checkChange, checkNewRange, parseNote, parsePreviewAction, parseRangeBody } from "@/lib/vacation/validate";

const today = "2027-03-10";

describe("ranges", () => {
  it("expands inclusive ranges", () => {
    expect(expandRange({ from: "2027-02-27", to: "2027-03-02" })).toEqual(["2027-02-27", "2027-02-28", "2027-03-01", "2027-03-02"]);
    expect(rangeDays({ from: "2027-01-01", to: "2027-01-01" })).toBe(1);
  });
});

describe("parseRangeBody", () => {
  it("accepts a valid body and trims the note", () => {
    expect(parseRangeBody({ startDate: "2027-07-05", endDate: "2027-07-16", note: "  Meer " })).toEqual({
      ok: true,
      value: { startDate: "2027-07-05", endDate: "2027-07-16", note: "Meer" },
    });
  });
  it("rejects bad dates and reversed ranges", () => {
    expect(parseRangeBody({ startDate: "2027-7-5", endDate: "2027-07-16" })).toEqual({ ok: false, error: "invalid" });
    expect(parseRangeBody({ startDate: "2027-07-16", endDate: "2027-07-05" })).toEqual({ ok: false, error: "invalid" });
    expect(parseRangeBody({ startDate: "2027-02-30", endDate: "2027-03-01" })).toEqual({ ok: false, error: "invalid" });
  });
  it("rejects long notes", () => {
    expect(parseRangeBody({ startDate: "2027-07-05", endDate: "2027-07-05", note: "x".repeat(501) })).toEqual({ ok: false, error: "invalid" });
  });
});

describe("parseNote", () => {
  it("requires a reason when asked", () => {
    expect(parseNote("  ", true)).toEqual({ ok: false, error: "reasonRequired" });
    expect(parseNote(undefined, false)).toEqual({ ok: true, value: null });
  });
});

describe("checkNewRange", () => {
  it("needs a start after today, at most 366 days and no overlap", () => {
    expect(checkNewRange({ from: "2027-03-10", to: "2027-03-12" }, today, [])).toBe("begun");
    expect(checkNewRange({ from: "2027-03-11", to: "2028-03-11" }, today, [])).toBe("tooLong");
    expect(checkNewRange({ from: "2027-04-01", to: "2027-04-05" }, today, [{ from: "2027-04-05", to: "2027-04-09" }])).toBe("overlap");
    expect(checkNewRange({ from: "2027-04-01", to: "2027-04-04" }, today, [{ from: "2027-04-05", to: "2027-04-09" }])).toBeNull();
  });
});

describe("checkChange", () => {
  it("allows any future change of a vacation that has not begun", () => {
    expect(checkChange({ from: "2027-04-01", to: "2027-04-05" }, { from: "2027-04-02", to: "2027-04-09" }, today, [])).toBeNull();
    expect(checkChange({ from: "2027-04-01", to: "2027-04-05" }, { from: "2027-03-10", to: "2027-04-09" }, today, [])).toBe("begun");
  });
  it("only moves the end of a running vacation, not before today", () => {
    const running = { from: "2027-03-08", to: "2027-03-20" };
    expect(checkChange(running, { from: "2027-03-08", to: "2027-03-12" }, today, [])).toBeNull();
    expect(checkChange(running, { from: "2027-03-08", to: "2027-03-09" }, today, [])).toBe("begun");
    expect(checkChange(running, { from: "2027-03-09", to: "2027-03-20" }, today, [])).toBe("begun");
  });
  it("rejects past vacations and overlaps", () => {
    expect(checkChange({ from: "2027-03-01", to: "2027-03-05" }, { from: "2027-03-01", to: "2027-03-12" }, today, [])).toBe("begun");
    expect(checkChange({ from: "2027-04-01", to: "2027-04-05" }, { from: "2027-04-01", to: "2027-04-10" }, today, [{ from: "2027-04-10", to: "2027-04-12" }])).toBe("overlap");
  });
});

describe("checkCancel", () => {
  it("cancels only vacations that have not begun", () => {
    expect(checkCancel({ from: "2027-03-11", to: "2027-03-15" }, today)).toBeNull();
    expect(checkCancel({ from: "2027-03-10", to: "2027-03-15" }, today)).toBe("begun");
  });
});

describe("parsePreviewAction", () => {
  it("reads the action from body.action", () => {
    expect(parsePreviewAction({ action: { kind: "enter", userId: "u1", startDate: "2027-04-01", endDate: "2027-04-03" } })).toEqual({
      ok: true,
      value: { kind: "enter", userId: "u1", startDate: "2027-04-01", endDate: "2027-04-03" },
    });
    expect(parsePreviewAction({ action: { kind: "approve", vacationId: "v1" } })).toEqual({ ok: true, value: { kind: "approve", vacationId: "v1" } });
    expect(parsePreviewAction({ action: { kind: "approveChange", changeId: "c1" } })).toEqual({ ok: true, value: { kind: "approveChange", changeId: "c1" } });
  });

  it("rejects a flat body, unknown kinds and missing ids", () => {
    expect(parsePreviewAction({ kind: "approve", vacationId: "v1" })).toEqual({ ok: false, error: "invalid" });
    expect(parsePreviewAction({ action: { kind: "bogus" } })).toEqual({ ok: false, error: "invalid" });
    expect(parsePreviewAction({ action: { kind: "cancel" } })).toEqual({ ok: false, error: "invalid" });
    expect(parsePreviewAction({ action: { kind: "change", vacationId: "v1", startDate: "2027-04-03", endDate: "2027-04-01" } })).toEqual({ ok: false, error: "invalid" });
    expect(parsePreviewAction(null)).toEqual({ ok: false, error: "invalid" });
  });
});
