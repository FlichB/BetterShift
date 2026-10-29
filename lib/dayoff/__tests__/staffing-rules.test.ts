// [fork] Dienstfrei rules with a Mindestbesetzung (SPEC 12.44).
import { describe, expect, it } from "vitest";
import { checkAcceptDate, checkCounter, checkMove, checkProposeDates, makeIsOff, revalidate, type DayOffState } from "@/lib/dayoff/rules";

const today = "2026-11-01";
const none = makeIsOff(new Set(), new Set());
// Duty Sat 2026-11-14; Mon 11-16 is the standard day after it, the week before is 11-09 … 11-13.
const row = (over: Partial<DayOffState> = {}): DayOffState => ({ status: "standard", date: "2026-11-16", standardDate: "2026-11-16", dutyDate: "2026-11-14", ...over });
const full = (...dates: string[]) => (d: string) => dates.includes(d);

describe("standard Dienstfrei and full days", () => {
  it("skips a full standard day but keeps the Standardtag as anchor", () =>
    expect(revalidate(row(), none, today, "after", full("2026-11-16"))).toEqual({ status: "standard", date: "2026-11-17", standardDate: "2026-11-16", notify: null }));
  it("before the duty: skips full days of the week before", () =>
    expect(revalidate(row({ date: "2026-11-09", standardDate: "2026-11-09" }), none, today, "before", full("2026-11-09", "2026-11-10"))).toMatchObject({ date: "2026-11-11", standardDate: "2026-11-09" }));
  it("falls back to the Standardtag when every day is full", () =>
    expect(revalidate(row(), none, today, "after", () => true)).toMatchObject({ status: "standard", date: "2026-11-16" }));
  it("a moved Dienstfrei on a full day stays", () =>
    expect(revalidate(row({ status: "moved", date: "2026-11-18" }), none, today, "after", full("2026-11-18"))).toEqual({ status: "moved", date: "2026-11-18", standardDate: "2026-11-16", notify: null }));
  it("an agreed Dienstfrei on a full day stays", () =>
    expect(revalidate(row({ status: "agreed", date: "2026-11-25" }), none, today, "after", full("2026-11-25"))).toMatchObject({ status: "agreed", date: "2026-11-25" }));
  it("a moved Dienstfrei that became invalid falls back to the first free day", () =>
    expect(revalidate(row({ status: "moved", date: "2026-11-18" }), makeIsOff(new Set(["2026-11-18"]), new Set()), today, "after", full("2026-11-16"))).toEqual({ status: "standard", date: "2026-11-17", standardDate: "2026-11-16", notify: "reset" }));
  it("without isFull nothing changes", () =>
    expect(revalidate(row(), none, today, "after")).toEqual({ status: "standard", date: "2026-11-16", standardDate: "2026-11-16", notify: null }));
});

describe("actions on full days", () => {
  it("move to a full day fails, staying on the current day does not", () => {
    expect(checkMove(row(), "2026-11-18", none, today, "after", full("2026-11-18"))).toEqual({ ok: false, code: "belowMinimum" });
    expect(checkMove(row({ date: "2026-11-18", status: "moved" }), "2026-11-18", none, today, "after", full("2026-11-18")).ok).toBe(true);
  });
  it("other date errors win over belowMinimum", () =>
    expect(checkMove(row(), "2026-11-21", none, today, "after", () => true)).toEqual({ ok: false, code: "outsideWeek" }));
  it("holder proposals on full days fail", () =>
    expect(checkProposeDates(row({ status: "locked", date: null }), ["2026-11-18", "2026-11-19"], [], none, today, full("2026-11-19"))).toEqual({ ok: false, code: "belowMinimum" }));
  it("counter and accept fail on full days", () => {
    expect(checkCounter(row({ status: "locked", date: null }), "2026-11-18", [], none, today, full("2026-11-18"))).toEqual({ ok: false, code: "belowMinimum" });
    expect(checkAcceptDate(row({ status: "locked", date: null }), "2026-11-18", none, today, full("2026-11-18"))).toEqual({ ok: false, code: "belowMinimum" });
  });
});
