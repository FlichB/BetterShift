import { describe, expect, it } from "vitest";
import { dutyGroups, generateDays, generateDuties, suggestStartOffset } from "@/lib/rotation/generate";
import type { RotationRule } from "@/lib/rotation/types";

const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
const six = eight.slice(0, 6);

/** For every Teilnehmer: gaps between own duties and whether a partner repeated. */
function audit(groups: string[][]) {
  const last = new Map<string, number>();
  const lastGroup = new Map<string, string[]>();
  const gaps: number[] = [];
  let samePartner = 0;
  groups.forEach((group, t) => {
    for (const u of group) {
      const prev = last.get(u);
      if (prev !== undefined) {
        gaps.push(t - prev);
        if (group.some((v) => v !== u && lastGroup.get(u)!.includes(v))) samePartner++;
      }
      last.set(u, t);
      lastGroup.set(u, group);
    }
  });
  return { minGap: Math.min(...gaps), samePartner };
}

const saturdays: RotationRule = {
  memberIds: eight,
  perShift: 2,
  period: "week",
  periodDays: null,
  startDate: "2026-11-02",
  startOffset: 0,
  weekdays: [6],
  closedDates: [],
  openHolidays: [],
};

describe("generateDuties", () => {
  it("8 Teilnehmer / 2 pro Dienst / Samstag: einmal pro Runde, wechselnde Partner, nie zwei Samstage in Folge", () => {
    const duties = generateDuties(saturdays, "2026-11-02", "2028-12-31");
    expect(duties.slice(0, 4).map((d) => d.userIds)).toEqual([["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]);
    for (let r = 0; r + 4 <= duties.length; r += 4) {
      expect(duties.slice(r, r + 4).flatMap((d) => d.userIds).sort()).toEqual(eight);
    }
    const { minGap, samePartner } = audit(duties.map((d) => d.userIds));
    expect(minGap).toBeGreaterThanOrEqual(2);
    expect(samePartner).toBe(0);
    expect(new Set(duties.map((d) => d.userIds.join())).size).toBe(28); // every pair comes up
  });

  it("6 Teilnehmer / 2 pro Dienst: alle 15 Paare in 15 Samstagen, je Quartal höchstens 1 Dienst Unterschied", () => {
    const rule: RotationRule = { ...saturdays, memberIds: six, startDate: "2027-01-01" };
    const duties = generateDuties(rule, "2027-01-01", "2029-12-31");
    expect(new Set(duties.slice(0, 15).map((d) => d.userIds.join())).size).toBe(15);
    const { minGap, samePartner } = audit(duties.map((d) => d.userIds));
    expect(minGap).toBeGreaterThanOrEqual(2);
    expect(samePartner).toBe(0);

    const quarters = new Map<string, string[][]>();
    for (const d of duties) {
      const q = `${d.date.slice(0, 4)}-${Math.floor((Number(d.date.slice(5, 7)) - 1) / 3)}`;
      quarters.set(q, [...(quarters.get(q) ?? []), d.userIds]);
    }
    for (const groups of quarters.values()) {
      const counts = six.map((id) => groups.filter((g) => g.includes(id)).length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
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
    const duties = generateDuties(rule, "2026-11-02", "2026-11-09");
    expect(duties.map((d) => d.date)).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09",
    ]);
    expect(duties[3].userIds).toEqual(["g", "h"]);
    // Fri and Mon are consecutive duties, so nobody serves both
    expect(duties[4].userIds.some((id) => duties[5].userIds.includes(id))).toBe(false);
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

  it("Schließtag: the pair moves to the next Saturday and the day becomes a closure", () => {
    const rule: RotationRule = { ...saturdays, closedDates: [{ date: "2026-11-14", reason: "Inventur", source: "skip" }] };
    expect(generateDays(rule, "2026-11-02", "2026-11-28")).toEqual({
      duties: [
        { date: "2026-11-07", userIds: ["a", "b"] },
        { date: "2026-11-21", userIds: ["c", "d"] },
        { date: "2026-11-28", userIds: ["e", "f"] },
      ],
      closures: [{ date: "2026-11-14", reason: "Inventur", source: "skip" }],
    });
  });

  it("ignores a Feiertag on a weekday that is no Diensttag", () => {
    const rule: RotationRule = { ...saturdays, closedDates: [{ date: "2026-12-08", reason: "Mariä Empfängnis", source: "holiday" }] };
    const days = generateDays(rule, "2026-12-01", "2026-12-13");
    expect(days.closures).toEqual([]);
    expect(days.duties.map((d) => d.date)).toEqual(["2026-12-05", "2026-12-12"]);
  });

  it("a Schließtag before the window still shifts the Besetzung inside it", () => {
    const closed: RotationRule = { ...saturdays, closedDates: [{ date: "2026-11-07", reason: "Inventur", source: "skip" }] };
    expect(generateDuties(closed, "2026-11-14", "2026-11-14")).toEqual([{ date: "2026-11-14", userIds: ["a", "b"] }]);
    expect(generateDays(closed, "2026-11-14", "2026-11-14").closures).toEqual([]);
  });

  it("marks a Geöffneter Feiertag on the duty", () => {
    const rule: RotationRule = { ...saturdays, openHolidays: [{ date: "2029-12-08", name: "Mariä Empfängnis" }], startDate: "2029-12-03" };
    expect(generateDuties(rule, "2029-12-03", "2029-12-09")).toEqual([
      { date: "2029-12-08", userIds: ["a", "b"], openHoliday: "Mariä Empfängnis" },
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

describe("dutyGroups", () => {
  it("starts with plain round robin from startOffset", () => {
    const groups = dutyGroups({ ...saturdays, startOffset: 6 });
    expect([groups.next().value, groups.next().value]).toEqual([["g", "h"], ["a", "b"]]);
  });

  it("is deterministic", () => {
    const take = (n: number) => {
      const g = dutyGroups(saturdays);
      return Array.from({ length: n }, () => g.next().value);
    };
    expect(take(40)).toEqual(take(40));
  });

  it("7 Teilnehmer: each serves twice per 7-duty round", () => {
    const g = dutyGroups({ ...saturdays, memberIds: eight.slice(0, 7) });
    const groups = Array.from({ length: 70 }, () => g.next().value as string[]);
    for (let r = 0; r < 70; r += 7) {
      const seats = groups.slice(r, r + 7).flat();
      for (const id of eight.slice(0, 7)) expect(seats.filter((s) => s === id)).toHaveLength(2);
    }
    expect(audit(groups).minGap).toBeGreaterThanOrEqual(2);
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

  it("skips ahead so nobody of the last duty serves the first one again", () => {
    expect(suggestStartOffset(eight, ["a", "h"], 2)).toBe(1); // after h is a → start at b
    expect(suggestStartOffset(eight, ["c", "d"], 2)).toBe(4);
  });
});
