// [fork] Dienstfrei rules (design 3).
import { describe, expect, it } from "vitest";
import {
  checkAcceptDate, checkCounter, checkLock, checkMove, checkProposeDates, isFrozen, makeIsOff,
  revalidate, standardDate, transferStatus, weekOf, type DayOffState,
} from "@/lib/dayoff/rules";

const none = makeIsOff(new Set(), new Set());
const today = "2026-11-01"; // Sunday
const row = (p: Partial<DayOffState> = {}): DayOffState => ({ status: "standard", date: "2026-11-09", standardDate: "2026-11-09", dutyDate: "2026-11-07", ...p });

describe("standardDate", () => {
  it("is the Monday after a Saturday duty", () => expect(standardDate("2026-11-07", none)).toBe("2026-11-09"));
  it("skips a holiday Monday", () => expect(standardDate("2026-04-04", makeIsOff(new Set(["2026-04-06"]), new Set()))).toBe("2026-04-07"));
  it("skips a whole closed week into the next one", () => {
    const closed = new Set(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(standardDate("2026-12-26", makeIsOff(closed, new Set()))).toBe("2027-01-04");
  });
  it("skips a date taken by another own Dienstfrei", () => expect(standardDate("2026-11-07", makeIsOff(new Set(), new Set(["2026-11-09"])))).toBe("2026-11-10"));
});

describe("weekOf", () => {
  it("lists Mo–Fr", () => expect(weekOf("2026-11-11")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]));
});

describe("checkMove", () => {
  it("moves within the week", () => expect(checkMove(row(), "2026-11-11", none, today)).toEqual({ ok: true, value: { status: "moved", date: "2026-11-11" } }));
  it("moving back to the standard day is standard", () =>
    expect(checkMove(row({ status: "moved", date: "2026-11-11" }), "2026-11-09", none, today)).toEqual({ ok: true, value: { status: "standard", date: "2026-11-09" } }));
  it("rejects the next week", () => expect(checkMove(row(), "2026-11-16", none, today)).toEqual({ ok: false, code: "outsideWeek" }));
  it("rejects a holiday", () => expect(checkMove(row(), "2026-11-11", makeIsOff(new Set(["2026-11-11"]), new Set()), today)).toEqual({ ok: false, code: "notWorkday" }));
  it("rejects a taken day", () => expect(checkMove(row(), "2026-11-11", makeIsOff(new Set(), new Set(["2026-11-11"])), today)).toEqual({ ok: false, code: "taken" }));
  it("rejects locked and agreed", () => {
    expect(checkMove(row({ status: "locked", date: null }), "2026-11-11", none, today)).toEqual({ ok: false, code: "wrongStatus" });
    expect(checkMove(row({ status: "agreed" }), "2026-11-11", none, today)).toEqual({ ok: false, code: "wrongStatus" });
  });
  it("rejects when the old or the new day has begun", () => {
    expect(checkMove(row(), "2026-11-11", none, "2026-11-09")).toEqual({ ok: false, code: "alreadyStarted" });
    expect(checkMove(row({ date: "2026-11-12" }), "2026-11-10", none, "2026-11-10")).toEqual({ ok: false, code: "alreadyStarted" });
  });
});

describe("checkLock", () => {
  it("locks standard, moved and agreed", () => {
    for (const status of ["standard", "moved", "agreed"] as const) expect(checkLock(row({ status }), today).ok).toBe(true);
  });
  it("rejects locked, dropped and begun", () => {
    expect(checkLock(row({ status: "locked", date: null }), today)).toEqual({ ok: false, code: "wrongStatus" });
    expect(checkLock(row({ status: "dropped" }), today)).toEqual({ ok: false, code: "wrongStatus" });
    expect(checkLock(row(), "2026-11-09")).toEqual({ ok: false, code: "alreadyStarted" });
  });
});

describe("checkProposeDates", () => {
  const locked = row({ status: "locked", date: null });
  it("accepts dates in the window, sorted and unique", () =>
    expect(checkProposeDates(locked, ["2026-11-20", "2026-11-18", "2026-11-18"], [], none, today)).toEqual({ ok: true, value: ["2026-11-18", "2026-11-20"] }));
  it("allows the last window day and rejects the day after", () => {
    expect(checkProposeDates(locked, ["2027-02-05"], [], none, today).ok).toBe(true); // Fri, window end 2027-02-07
    expect(checkProposeDates(locked, ["2027-02-08"], [], none, today)).toEqual({ ok: false, code: "outsideWindow" });
  });
  it("rejects weekends, begun days, duplicates of open proposals, too many dates", () => {
    expect(checkProposeDates(locked, ["2026-11-21"], [], none, today)).toEqual({ ok: false, code: "notWorkday" });
    expect(checkProposeDates(locked, ["2026-11-01"], [], none, today)).toEqual({ ok: false, code: "alreadyStarted" });
    expect(checkProposeDates(locked, ["2026-11-18"], ["2026-11-18"], none, today)).toEqual({ ok: false, code: "duplicate" });
    expect(checkProposeDates(locked, ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23"], [], none, today)).toEqual({ ok: false, code: "tooMany" });
    const open = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"];
    expect(checkProposeDates(locked, ["2026-11-18", "2026-11-19"], open, none, today)).toEqual({ ok: false, code: "tooMany" });
  });
  it("is a change request when agreed, but not for the agreed date", () => {
    expect(checkProposeDates(row({ status: "agreed", date: "2026-11-18" }), ["2026-11-19"], [], none, today).ok).toBe(true);
    expect(checkProposeDates(row({ status: "agreed", date: "2026-11-18" }), ["2026-11-18"], [], none, today)).toEqual({ ok: false, code: "duplicate" });
  });
  it("rejects standard and moved", () => expect(checkProposeDates(row(), ["2026-11-18"], [], none, today)).toEqual({ ok: false, code: "wrongStatus" }));
});

describe("checkCounter / checkAcceptDate", () => {
  const locked = row({ status: "locked", date: null });
  it("counter has no window limit", () => expect(checkCounter(locked, "2027-06-01", [], none, today)).toEqual({ ok: true, value: "2027-06-01" }));
  it("accept re-checks the date", () => {
    expect(checkAcceptDate(locked, "2026-11-18", none, today).ok).toBe(true);
    expect(checkAcceptDate(locked, "2026-11-18", makeIsOff(new Set(["2026-11-18"]), new Set()), today)).toEqual({ ok: false, code: "notWorkday" });
    expect(checkAcceptDate(locked, "2026-11-18", none, "2026-11-18")).toEqual({ ok: false, code: "alreadyStarted" });
  });
});

describe("transferStatus", () => {
  it("maps per SPEC 12.38", () => {
    expect(transferStatus("standard")).toBe("standard");
    expect(transferStatus("moved")).toBe("standard");
    expect(transferStatus("locked")).toBe("locked");
    expect(transferStatus("agreed")).toBe("locked");
    expect(transferStatus("dropped")).toBeNull();
  });
});

describe("revalidate", () => {
  const holidayMon = makeIsOff(new Set(["2026-11-09"]), new Set());
  it("standard wanders silently", () => expect(revalidate(row(), holidayMon, today)).toEqual({ status: "standard", date: "2026-11-10", standardDate: "2026-11-10", notify: null }));
  it("moved falls back to standard with a notice", () =>
    expect(revalidate(row({ status: "moved", date: "2026-11-11" }), makeIsOff(new Set(["2026-11-11"]), new Set()), today)).toEqual({ status: "standard", date: "2026-11-09", standardDate: "2026-11-09", notify: "reset" }));
  it("valid moved stays", () => expect(revalidate(row({ status: "moved", date: "2026-11-11" }), holidayMon, today)).toEqual({ status: "moved", date: "2026-11-11", standardDate: "2026-11-10", notify: null }));
  it("agreed becomes locked with a notice", () =>
    expect(revalidate(row({ status: "agreed", date: "2026-11-18" }), makeIsOff(new Set(["2026-11-18"]), new Set()), today)).toEqual({ status: "locked", date: null, standardDate: "2026-11-09", notify: "reset" }));
  it("locked stays locked", () => expect(revalidate(row({ status: "locked", date: null }), none, today)).toEqual({ status: "locked", date: null, standardDate: "2026-11-09", notify: null }));
});

describe("isFrozen", () => {
  it("freezes dated rows from their day on, never locked ones", () => {
    expect(isFrozen(row(), "2026-11-09")).toBe(true);
    expect(isFrozen(row(), "2026-11-08")).toBe(false);
    expect(isFrozen(row({ status: "locked", date: null }), "2027-01-01")).toBe(false);
    expect(isFrozen(row({ status: "dropped" }), today)).toBe(true);
  });
});
