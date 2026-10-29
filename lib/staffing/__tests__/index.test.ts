// [fork] Mindestbesetzung: pure counting (SPEC 12.44).
import { describe, expect, it } from "vitest";
import { StaffingIndex, emptyStaffing, type StaffingScope } from "@/lib/staffing/index";

const people = ["a", "b", "c", "d"];
const scope = (over: Partial<StaffingScope> = {}): StaffingScope => ({
  rotationId: "r1",
  rotationName: "Samstag",
  minimum: 3,
  participants: people,
  closed: new Set(),
  ...over,
});
// 2026-11-16 is a Monday, 2026-11-21 a Saturday.
const MON = "2026-11-16";
const TUE = "2026-11-17";
const SAT = "2026-11-21";

describe("StaffingIndex", () => {
  it("a day is full when one more absence would break the minimum", () => {
    const index = new StaffingIndex([scope()], new Map(), [{ id: "x", userId: "a", date: MON }]);
    expect(index.gapIfAbsent("b", MON)).toEqual({ rotationId: "r1", rotationName: "Samstag", date: MON, present: 2, minimum: 3 });
    expect(index.isFull("b")(MON)).toBe(true);
    expect(index.isFull("b")(TUE)).toBe(false);
  });

  it("the person's own absence on that day does not count against them", () => {
    const index = new StaffingIndex([scope()], new Map(), [{ id: "x", userId: "a", date: MON }]);
    expect(index.isFull("a")(MON)).toBe(false);
  });

  it("vacations count as absent", () => {
    const index = new StaffingIndex([scope()], new Map([["c", [{ from: MON, to: TUE }]]]), []);
    expect(index.isFull("a")(MON)).toBe(true);
    expect(index.isFull("a")("2026-11-18")).toBe(false);
  });

  it("weekends and Schließtage are never full", () => {
    const index = new StaffingIndex([scope({ minimum: 4 - 1, closed: new Set([TUE]) })], new Map([["c", [{ from: MON, to: SAT }]]]), []);
    expect(index.isFull("a")(TUE)).toBe(false);
    expect(index.isFull("a")(SAT)).toBe(false);
  });

  it("people outside every scope are never full", () => {
    const index = new StaffingIndex([scope()], new Map([["c", [{ from: MON, to: MON }]]]), []);
    expect(index.isFull("z")(MON)).toBe(false);
  });

  it("takes the worst of several scopes", () => {
    const small = scope({ rotationId: "r2", rotationName: "Kasse", participants: ["a", "b", "e"], minimum: 2 });
    const index = new StaffingIndex([scope(), small], new Map(), [{ id: "x", userId: "e", date: MON }]);
    expect(index.gapIfAbsent("a", MON)).toMatchObject({ rotationId: "r2", present: 1, minimum: 2 });
  });

  it("place moves and removes a Dienstfrei", () => {
    const index = new StaffingIndex([scope()], new Map(), []);
    index.place("x", "a", MON);
    expect(index.isFull("b")(MON)).toBe(true);
    index.place("x", "a", TUE);
    expect(index.isFull("b")(MON)).toBe(false);
    expect(index.isFull("b")(TUE)).toBe(true);
    index.place("x", "a", null);
    expect(index.isFull("b")(TUE)).toBe(false);
  });

  it("gapsFor lists Werktage below the minimum with the person counted absent", () => {
    const index = new StaffingIndex([scope()], new Map([["b", [{ from: MON, to: MON }]]]), []);
    index.setRanges("a", [{ from: MON, to: "2026-11-22" }]);
    expect(index.gapsFor("a", [MON, TUE, SAT])).toEqual([{ rotationId: "r1", rotationName: "Samstag", date: MON, present: 2, minimum: 3 }]);
  });

  it("emptyStaffing returns a fresh index per call", () => {
    const first = emptyStaffing();
    const second = emptyStaffing();
    expect(first).not.toBe(second);
    first.place("x", "p", MON);
    expect(first.isAbsent("p", MON)).toBe(true);
    expect(second.isAbsent("p", MON)).toBe(false);
  });
});
