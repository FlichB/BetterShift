import { describe, expect, it } from "vitest";
import { isValidYearsAhead, syncWindowEnd } from "@/lib/sync-window/window";

describe("syncWindowEnd", () => {
  it("ends on 31.12. of the year after next by default", () => {
    const end = syncWindowEnd(new Date(2026, 9, 29, 10, 0));
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours()]).toEqual([2028, 11, 31, 23]);
  });

  it("counts from the current year, also on 1 January and 31 December", () => {
    expect(syncWindowEnd(new Date(2027, 0, 1), 0).getFullYear()).toBe(2027);
    expect(syncWindowEnd(new Date(2027, 11, 31, 23, 0), 1).getFullYear()).toBe(2028);
  });
});

describe("isValidYearsAhead", () => {
  it("accepts whole years from 0 to 10", () => {
    expect([0, 2, 10].every(isValidYearsAhead)).toBe(true);
    expect([-1, 11, 1.5, "2", null].some(isValidYearsAhead)).toBe(false);
  });
});
