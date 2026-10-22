import { describe, expect, it } from "vitest";
import { generateDuties, seatsFor, suggestStartOffset } from "@/lib/rotation/generate";
import type { RotationRule } from "@/lib/rotation/types";

const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];

const saturdays: RotationRule = {
  memberIds: eight,
  perShift: 2,
  period: "week",
  periodDays: null,
  startDate: "2026-11-02",
  startOffset: 0,
  weekdays: [6],
  skipDates: [],
};

describe("generateDuties", () => {
  it("8 Teilnehmer / 2 pro Dienst / Samstag: jede Person exakt jede 4. Woche", () => {
    const duties = generateDuties(saturdays, "2026-11-02", "2027-01-31");
    expect(duties[0]).toEqual({ date: "2026-11-07", userIds: ["a", "b"] });
    expect(duties[1]).toEqual({ date: "2026-11-14", userIds: ["c", "d"] });
    expect(duties[4]).toEqual({ date: "2026-12-05", userIds: ["a", "b"] });
    for (const id of eight) {
      const weeks = duties.flatMap((d, i) => (d.userIds.includes(id) ? [i] : []));
      for (let k = 1; k < weeks.length; k++) expect(weeks[k] - weeks[k - 1]).toBe(4);
    }
  });

  it("is independent of the requested window", () => {
    const all = generateDuties(saturdays, "2026-11-02", "2027-03-01");
    const later = generateDuties(saturdays, "2027-01-01", "2027-03-01");
    expect(later).toEqual(all.filter((d) => d.date >= "2027-01-01"));
  });

  it("never yields duties before startDate", () => {
    expect(generateDuties(saturdays, "2026-10-01", "2026-11-06")).toEqual([]);
  });

  it("7 Teilnehmer / 2 pro Dienst: gleichmäßig, nie doppelt im selben Dienst", () => {
    const rule: RotationRule = { ...saturdays, memberIds: eight.slice(0, 7) };
    const duties = generateDuties(rule, "2026-11-02", "2027-02-20"); // 7 Dienste+
    const firstSeven = duties.slice(0, 7);
    for (const d of firstSeven) expect(new Set(d.userIds).size).toBe(2);
    for (const id of rule.memberIds) {
      expect(firstSeven.filter((d) => d.userIds.includes(id))).toHaveLength(2);
    }
  });

  it("perShift = 1 rotates one person per duty", () => {
    const rule: RotationRule = { ...saturdays, perShift: 1, memberIds: ["a", "b", "c"] };
    expect(generateDuties(rule, "2026-11-02", "2026-11-28").map((d) => d.userIds)).toEqual([
      ["a"], ["b"], ["c"], ["a"],
    ]);
  });

  it("week period started mid-week: the partial week is the first period", () => {
    const rule: RotationRule = {
      ...saturdays,
      startDate: "2026-11-04", // Wednesday
      weekdays: [1, 2, 3, 4, 5],
    };
    const duties = generateDuties(rule, "2026-11-01", "2026-11-13");
    expect(duties.map((d) => d.date)).toEqual([
      "2026-11-04", "2026-11-05", "2026-11-06",
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13",
    ]);
    expect(duties[0].userIds).toEqual(["a", "b"]);
    expect(duties[2].userIds).toEqual(["a", "b"]);
    expect(duties[3].userIds).toEqual(["c", "d"]);
  });

  it("day period with weekdays only (Mo–Fr) rotates per duty day", () => {
    const rule: RotationRule = {
      ...saturdays,
      period: "day",
      weekdays: [1, 2, 3, 4, 5],
    };
    const duties = generateDuties(rule, "2026-11-06", "2026-11-09");
    expect(duties).toEqual([
      { date: "2026-11-06", userIds: ["a", "b"] }, // Fri = duty #4 → (4*2)%8 = 0
      { date: "2026-11-09", userIds: ["c", "d"] }, // Mon = duty #5
    ]);
  });

  it("custom period length in days", () => {
    const rule: RotationRule = {
      ...saturdays,
      period: "days",
      periodDays: 3,
      weekdays: [],
      memberIds: ["a", "b"],
      perShift: 1,
    };
    expect(generateDuties(rule, "2026-11-02", "2026-11-08").map((d) => d.userIds[0])).toEqual([
      "a", "a", "a", "b", "b", "b", "a",
    ]);
  });

  it("Ausfalltag: the pair moves to the next Saturday", () => {
    const rule: RotationRule = { ...saturdays, skipDates: ["2026-11-14"] };
    const duties = generateDuties(rule, "2026-11-02", "2026-11-28");
    expect(duties).toEqual([
      { date: "2026-11-07", userIds: ["a", "b"] },
      { date: "2026-11-21", userIds: ["c", "d"] },
      { date: "2026-11-28", userIds: ["e", "f"] },
    ]);
  });

  it("applies startOffset", () => {
    const rule: RotationRule = { ...saturdays, startOffset: 3 };
    expect(generateDuties(rule, "2026-11-02", "2026-11-14").map((d) => d.userIds)).toEqual([
      ["d", "e"], ["f", "g"],
    ]);
  });

  it("rejects impossible rules", () => {
    expect(() => generateDuties({ ...saturdays, perShift: 0 }, "2026-11-02", "2026-11-30")).toThrow(RangeError);
    expect(() => generateDuties({ ...saturdays, memberIds: ["a"] }, "2026-11-02", "2026-11-30")).toThrow(RangeError);
    expect(() =>
      generateDuties({ ...saturdays, period: "days", periodDays: null }, "2026-11-02", "2026-11-30")
    ).toThrow(RangeError);
  });
});

describe("seatsFor", () => {
  it("wraps around the member list", () => {
    expect(seatsFor(saturdays, 3)).toEqual(["g", "h"]);
    expect(seatsFor(saturdays, 4)).toEqual(["a", "b"]);
  });
});

describe("suggestStartOffset", () => {
  it("starts after the last duty's latest position", () => {
    expect(suggestStartOffset(eight, ["c", "d"])).toBe(4);
    expect(suggestStartOffset(eight, ["g", "h"])).toBe(0);
  });

  it("ignores Teilnehmer who left and falls back to 0", () => {
    const withoutD = eight.filter((id) => id !== "d");
    expect(suggestStartOffset(withoutD, ["c", "d"])).toBe(3); // c is at 2 → next is 3 ("e")
    expect(suggestStartOffset(eight, [])).toBe(0);
    expect(suggestStartOffset(eight, ["x"])).toBe(0);
  });
});
