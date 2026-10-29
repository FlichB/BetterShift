import { describe, expect, it } from "vitest";
import { dutyGroups, generateDays, generateDuties, suggestStartOffset, yearSummary } from "@/lib/rotation/generate";
import type { Absence, RotationRule } from "@/lib/rotation/types";

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
  reinforcedDates: [],
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
        { date: "2026-11-07", userIds: ["a", "b"], capacity: 2 },
        { date: "2026-11-21", userIds: ["c", "d"], capacity: 2 },
        { date: "2026-11-28", userIds: ["e", "f"], capacity: 2 },
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

  it("adds a Schließeintrag for an Ausfalltag on a non-Diensttag, but not for a weekday holiday", () => {
    const rule: RotationRule = {
      ...saturdays,
      closedDates: [
        { date: "2026-11-11", reason: "Betriebsurlaub", source: "skip" },
        { date: "2026-11-12", reason: "Feiertag", source: "holiday" },
      ],
    };
    const days = generateDays(rule, "2026-11-09", "2026-11-15");
    expect(days.closures.map((c) => c.date)).toEqual(["2026-11-11"]);
    expect(days.duties.map((d) => d.date)).toEqual(["2026-11-14"]);
  });

  it("a Schließtag before the window still shifts the Besetzung inside it", () => {
    const closed: RotationRule = { ...saturdays, closedDates: [{ date: "2026-11-07", reason: "Inventur", source: "skip" }] };
    expect(generateDuties(closed, "2026-11-14", "2026-11-14")).toEqual([{ date: "2026-11-14", userIds: ["a", "b"], capacity: 2 }]);
    expect(generateDays(closed, "2026-11-14", "2026-11-14").closures).toEqual([]);
  });

  it("marks a Geöffneter Feiertag on the duty", () => {
    const rule: RotationRule = { ...saturdays, openHolidays: [{ date: "2029-12-08", name: "Mariä Empfängnis" }], startDate: "2029-12-03" };
    expect(generateDuties(rule, "2029-12-03", "2029-12-09")).toEqual([
      { date: "2029-12-08", userIds: ["a", "b"], capacity: 2, openHoliday: "Mariä Empfängnis" },
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
    expect(() => generateDuties({ ...saturdays, weekdays: [0] }, "2026-11-02", "2026-11-30")).toThrow(RangeError);
    expect(() => generateDuties({ ...saturdays, weekdays: [8] }, "2026-11-02", "2026-11-30")).toThrow(RangeError);
    expect(() =>
      generateDuties({ ...saturdays, reinforcedDates: [{ date: "2026-11-14", perShift: 0 }] }, "2026-11-02", "2026-11-30")
    ).toThrow(RangeError);
    expect(() =>
      generateDuties({ ...saturdays, reinforcedDates: [{ date: "2026-11-14", perShift: 2.5 }] }, "2026-11-02", "2026-11-30")
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

describe("verstärkte Tage", () => {
  const count = (duties: { userIds: string[] }[], ids: string[]) => {
    const counts = new Map(ids.map((id) => [id, 0]));
    for (const d of duties) for (const u of d.userIds) counts.set(u, counts.get(u)! + 1);
    return [...counts.values()];
  };
  const quarterSpreads = (duties: { date: string; userIds: string[] }[], ids: string[]) => {
    const byQuarter = new Map<string, { date: string; userIds: string[] }[]>();
    for (const d of duties) {
      const q = `${d.date.slice(0, 4)}-${Math.floor((Number(d.date.slice(5, 7)) - 1) / 3)}`;
      byQuarter.set(q, [...(byQuarter.get(q) ?? []), d]);
    }
    return [...byQuarter.values()].map((list) => {
      const c = count(list, ids);
      return Math.max(...c) - Math.min(...c);
    });
  };
  const reinforced: RotationRule = { ...saturdays, reinforcedDates: [{ date: "2026-12-19", perShift: 3 }] };

  it("gives the verstärkter Tag its capacity and three different people", () => {
    const duties = generateDuties(reinforced, "2026-12-12", "2026-12-26");
    expect(duties.map((d) => [d.date, d.capacity, d.userIds.length])).toEqual([
      ["2026-12-12", 2, 2],
      ["2026-12-19", 3, 3],
      ["2026-12-26", 2, 2],
    ]);
    expect(new Set(duties[1].userIds).size).toBe(3);
  });

  it("counts the Zusatzplatz fully: over the horizon Plätze per person differ by at most 1", () => {
    const duties = generateDuties(reinforced, "2026-11-02", "2028-12-31");
    const c = count(duties, eight);
    expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1);
    for (const d of duties) expect(new Set(d.userIds).size).toBe(d.userIds.length);
  });

  it("keeps the soft rules with a single verstärkter Tag and stays as fair per quarter as without", () => {
    const duties = generateDuties(reinforced, "2026-11-02", "2028-12-31");
    const { minGap, samePartner } = audit(duties.map((d) => d.userIds));
    expect(minGap).toBeGreaterThanOrEqual(2);
    expect(samePartner).toBe(0);
    const withSpread = quarterSpreads(duties, eight);
    const withoutSpread = quarterSpreads(generateDuties(saturdays, "2026-11-02", "2028-12-31"), eight);
    expect(Math.max(...withSpread)).toBeLessThanOrEqual(Math.max(...withoutSpread));
  });

  it("6 Teilnehmer with a verstärkter Tag: at most 1 apart per quarter", () => {
    const rule: RotationRule = { ...saturdays, memberIds: six, reinforcedDates: [{ date: "2027-02-06", perShift: 3 }] };
    const duties = generateDuties(rule, "2026-11-02", "2028-12-31");
    expect(Math.max(...quarterSpreads(duties, six))).toBeLessThanOrEqual(1);
  });

  it("several verstärkte Tage in a row: never twice in one duty, soft rules may give way", () => {
    const rule: RotationRule = {
      ...saturdays,
      reinforcedDates: [
        { date: "2026-12-05", perShift: 3 },
        { date: "2026-12-12", perShift: 3 },
        { date: "2026-12-19", perShift: 4 },
      ],
    };
    const duties = generateDuties(rule, "2026-11-02", "2027-12-31");
    for (const d of duties) {
      expect(d.userIds).toHaveLength(d.capacity!);
      expect(new Set(d.userIds).size).toBe(d.userIds.length);
    }
  });

  it("is independent of the requested window", () => {
    const full = generateDuties(reinforced, "2026-11-02", "2027-06-30").filter((d) => d.date >= "2026-12-01");
    expect(generateDuties(reinforced, "2026-12-01", "2027-06-30")).toEqual(full);
    // A window ending right before the verstärkter Tag must already plan around it.
    expect(generateDuties(reinforced, "2026-11-02", "2026-12-12")).toEqual(
      generateDuties(reinforced, "2026-11-02", "2027-06-30").filter((d) => d.date <= "2026-12-12")
    );
  });

  it("caps the capacity at the number of Teilnehmer", () => {
    const [duty] = generateDuties({ ...saturdays, reinforcedDates: [{ date: "2026-12-19", perShift: 12 }] }, "2026-12-19", "2026-12-19");
    expect(duty.capacity).toBe(8);
    expect([...duty.userIds].sort()).toEqual(eight);
  });

  it("ignores a verstärkter Tag on a non-Diensttag, before startDate or on a Schließtag", () => {
    const rule: RotationRule = {
      ...saturdays,
      reinforcedDates: [
        { date: "2026-12-18", perShift: 3 }, // Friday
        { date: "2026-10-31", perShift: 3 }, // before startDate
        { date: "2026-12-26", perShift: 3 }, // closed below
      ],
      closedDates: [{ date: "2026-12-26", reason: "Inventur", source: "skip" }],
    };
    const days = generateDays(rule, "2026-11-02", "2027-01-31");
    expect(days.duties.every((d) => d.capacity === 2)).toBe(true);
    expect(days.duties.map((d) => d.userIds)).toEqual(generateDays({ ...rule, reinforcedDates: [] }, "2026-11-02", "2027-01-31").duties.map((d) => d.userIds));
    expect(days.closures.map((c) => c.date)).toEqual(["2026-12-26"]);
  });
});

describe("Jahresausgleich (SPEC 12.41)", () => {
  const seven = eight.slice(0, 7);
  const yearly: RotationRule = { ...saturdays, yearlyFairness: true };

  function perYear(rule: RotationRule, year: number) {
    const counts = new Map(rule.memberIds.map((u) => [u, 0]));
    for (const d of generateDuties(rule, `${year}-01-01`, `${year}-12-31`)) {
      for (const u of d.userIds) counts.set(u, (counts.get(u) as number) + 1);
    }
    return counts;
  }

  const cases: [string, RotationRule][] = [
    ["8/2", yearly],
    ["7/2", { ...yearly, memberIds: seven }],
    ["6/2", { ...yearly, memberIds: six }],
    ["8/1", { ...yearly, perShift: 1 }],
    ["8/3", { ...yearly, perShift: 3 }],
    [
      "7/2 mit Schließtagen",
      {
        ...yearly,
        memberIds: seven,
        closedDates: [
          { date: "2027-03-06", reason: "Feiertag", source: "holiday" },
          { date: "2027-12-25", reason: "Weihnachten", source: "holiday" },
        ],
      },
    ],
    ["7/2 mit Verstärktem Tag", { ...yearly, memberIds: seven, reinforcedDates: [{ date: "2027-06-12", perShift: 3 }] }],
  ];

  it.each(cases)("%s: Plätze + Delta differ by at most 1 in every year", (_label, rule) => {
    for (let year = 2027; year <= 2029; year++) {
      const prev = perYear(rule, year - 1);
      const min = Math.min(...prev.values());
      const cur = perYear(rule, year);
      const totals = rule.memberIds.map((u) => (cur.get(u) as number) + (prev.get(u) as number) - min);
      expect(Math.max(...totals) - Math.min(...totals), `year ${year}`).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    ["8/2", yearly],
    ["7/2", { ...yearly, memberIds: seven }],
    ["6/2", { ...yearly, memberIds: six }],
    ["5/2", { ...yearly, memberIds: eight.slice(0, 5) }],
    ["4/1", { ...yearly, memberIds: eight.slice(0, 4), perShift: 1 }],
  ] as [string, RotationRule][])("%s: no back-to-back duty and no repeated partner across New Year", (_label, rule) => {
    const groups = generateDuties(rule, "2026-11-01", "2032-12-31").map((d) => d.userIds);
    const { minGap, samePartner } = audit(groups);
    expect(minGap).toBeGreaterThanOrEqual(2);
    expect(samePartner).toBe(0);
  });

  it("10/3: no back-to-back duty, no repeated partner around New Year, never more repeats than the plain generator", () => {
    // The plain 10/3 rotation itself repeats partners from its first round on, so 0 cannot be required overall.
    const rule: RotationRule = { ...yearly, memberIds: [...eight, "i", "j"], perShift: 3 };
    const repeats = (r: RotationRule) => {
      const duties = generateDuties(r, "2026-11-01", "2032-12-31");
      const lastGroup = new Map<string, string[]>();
      const dates: string[] = [];
      for (const d of duties) {
        if (d.userIds.some((u) => d.userIds.some((v) => v !== u && lastGroup.get(u)?.includes(v)))) dates.push(d.date);
        for (const u of d.userIds) lastGroup.set(u, d.userIds);
      }
      return { dates, minGap: audit(duties.map((d) => d.userIds)).minGap };
    };
    const yearlyRun = repeats(rule);
    expect(yearlyRun.minGap).toBeGreaterThanOrEqual(2);
    expect(yearlyRun.dates.filter((date) => date.slice(5) >= "12-01" || date.slice(5) <= "01-31")).toEqual([]);
    expect(yearlyRun.dates.length).toBeLessThanOrEqual(repeats({ ...rule, yearlyFairness: false }).dates.length);
  });

  it.each([
    ["10/3", [...eight, "i", "j"]],
    ["11/3", [...eight, "i", "j", "k"]],
  ])("%s from 7.12.: a Teilnehmer who did not serve in December still gets a polished January", (_label, memberIds) => {
    // Starting late in December leaves some Teilnehmer without a duty before New Year; their second
    // seat in the first plain round of 2027 used to price the round as NaN, so it stayed unpolished.
    const rule: RotationRule = {
      ...yearly,
      memberIds,
      perShift: 3,
      startDate: "2026-12-07",
      deltaOverrides: { 2027: Object.fromEntries(memberIds.map((u) => [u, 0])) },
    };
    const duties = generateDuties(rule, "2026-12-07", "2027-12-31");
    const lastGroup = new Map<string, string[]>();
    let repeats = 0;
    for (const d of duties) {
      if (d.date >= "2027-01-01") {
        for (const u of d.userIds) if (d.userIds.some((v) => v !== u && lastGroup.get(u)?.includes(v))) repeats++;
      }
      for (const u of d.userIds) lastGroup.set(u, d.userIds);
    }
    expect(audit(duties.map((d) => d.userIds)).minGap).toBeGreaterThanOrEqual(2);
    expect(repeats).toBeLessThanOrEqual(3);
  });

  it("settles an override of +1 first: c serves its first 2027 duty no earlier than everyone else", () => {
    const rule = { ...yearly, deltaOverrides: { 2027: { c: 1 } } };
    const duties = generateDuties(rule, "2027-01-01", "2027-03-31");
    const first = (u: string) => duties.findIndex((d) => d.userIds.includes(u));
    const others = eight.filter((u) => u !== "c").map(first);
    expect(Math.min(...others)).toBeGreaterThanOrEqual(0);
    expect(first("c")).toBeGreaterThanOrEqual(Math.max(...others));
  });

  it("settles a larger override over the year: +3 means about 3 fewer Plätze", () => {
    const counts = perYear({ ...yearly, deltaOverrides: { 2027: { c: 3 } } }, 2027);
    const others = eight.filter((u) => u !== "c").map((u) => counts.get(u) as number);
    expect(counts.get("c")).toBeLessThanOrEqual(Math.min(...others) - 2);
  });

  it("counts real holders over the plan", () => {
    const planned = generateDuties(yearly, "2026-11-07", "2026-11-07")[0].userIds;
    expect(planned).toEqual(["a", "b"]);
    const rows = yearSummary({ ...yearly, heldDuties: { "2026-11-07": ["a", "c"] } }, 2027)!;
    const delta = Object.fromEntries(rows.map((r) => [r.userId, r.delta]));
    expect(delta).toMatchObject({ a: 1, b: 0, c: 2, d: 1 });
  });

  it("leaves later joiners out of the minimum", () => {
    const rows = yearSummary({ ...yearly, memberSince: { h: "2026-12-01" } }, 2027)!;
    expect(rows.find((r) => r.userId === "h")).toMatchObject({ fullYear: false, autoDelta: 0 });
  });

  it("is null for the first year of a rotation", () => {
    expect(yearSummary(yearly, 2026)).toBeNull();
  });

  it("settles held Plätze from before a restart on 1 January", () => {
    const rule: RotationRule = { ...yearly, startDate: "2027-01-04", heldDuties: { "2026-12-26": ["a", "b"] } };
    const firstThree = generateDuties(rule, "2027-01-01", "2027-01-31").slice(0, 3);
    for (const d of firstThree) expect(d.userIds).not.toContain("a");
    for (const d of firstThree) expect(d.userIds).not.toContain("b");
  });

  it("does not settle again after a restart within the year", () => {
    const rule: RotationRule = {
      ...yearly,
      startDate: "2027-06-07",
      heldDuties: { "2026-12-26": ["a", "b"], "2027-01-02": ["c", "d"] },
    };
    expect(generateDuties(rule, "2027-06-01", "2027-06-30")[0].userIds).toEqual(["a", "b"]);
  });

  it("finishes a short last duty of the Ausgleichsphase in the next round", () => {
    // +1 for c: 7 compensation seats + 2 rounds of 8 = 23 seats, so the 12th duty of 2027 is a carry.
    const rule = { ...yearly, deltaOverrides: { 2027: { c: 1 } } };
    const duties = generateDuties(rule, "2027-01-01", "2027-06-30");
    for (const d of duties) {
      expect(d.userIds).toHaveLength(2);
      expect(new Set(d.userIds).size).toBe(2);
    }
    const counts = perYear(rule, 2027);
    const others = eight.filter((u) => u !== "c").map((u) => counts.get(u) as number);
    expect(Math.min(...others) - (counts.get("c") as number)).toBeGreaterThanOrEqual(0);
    const { minGap, samePartner } = audit(generateDuties(rule, "2026-11-01", "2027-12-31").map((d) => d.userIds));
    expect(minGap).toBeGreaterThanOrEqual(2);
    expect(samePartner).toBe(0);
  });

  it("does not report a settlement for a restart within the year", () => {
    const rule: RotationRule = { ...yearly, startDate: "2027-06-07", heldDuties: { "2027-01-02": ["c", "d"] } };
    expect(yearSummary(rule, 2027)).toBeNull();
  });

  it("is deterministic and identical to the plain generator when switched off", () => {
    expect(generateDays(yearly, "2026-11-01", "2028-12-31")).toEqual(generateDays(yearly, "2026-11-01", "2028-12-31"));
    const all = generateDuties(yearly, "2026-11-01", "2028-12-31");
    expect(generateDuties(yearly, "2027-06-01", "2028-12-31")).toEqual(all.filter((d) => d.date >= "2027-06-01"));
    expect(generateDays({ ...saturdays, yearlyFairness: false, deltaOverrides: { 2027: { c: 3 } } }, "2026-11-01", "2028-12-31")).toEqual(
      generateDays(saturdays, "2026-11-01", "2028-12-31")
    );
  });
});

describe("Urlaub (SPEC 12.43)", () => {
  const rule = (absences: Absence[], extra: Partial<RotationRule> = {}): RotationRule => ({
    ...saturdays,
    memberIds: eight,
    startDate: "2027-01-01",
    startOffset: 0,
    ...extra,
    absences,
  });
  const held = (r: RotationRule, from: string, to: string) => {
    const counts = new Map<string, number>(r.memberIds.map((u) => [u, 0]));
    for (const d of generateDuties(r, from, to)) for (const u of d.userIds) counts.set(u, (counts.get(u) ?? 0) + 1);
    return counts;
  };
  const on = (r: RotationRule, user: string, range: { from: string; to: string }) =>
    generateDuties(r, range.from, range.to)
      .filter((d) => d.userIds.includes(user))
      .map((d) => d.date);

  it("is identical without absences", () => {
    const base = rule([]);
    const without: RotationRule = { ...base };
    delete without.absences;
    expect(generateDays(base, "2027-01-01", "2028-12-31")).toEqual(generateDays(without, "2027-01-01", "2028-12-31"));
  });

  it("never seats someone on a vacation day", () => {
    const a = eight[2];
    const range = { from: "2027-03-01", to: "2027-03-31" };
    expect(on(rule([{ userId: a, ...range }]), a, range)).toEqual([]);
  });

  it("moves a one-day absence within the round without changing the year's counts", () => {
    const a = eight[0];
    const plain = rule([]);
    const firstDate = on(plain, a, { from: "2027-01-01", to: "2027-12-31" })[0];
    const r = rule([{ userId: a, from: firstDate, to: firstDate }]);
    expect(on(r, a, { from: firstDate, to: firstDate })).toEqual([]);
    expect(held(r, "2027-01-01", "2027-12-31")).toEqual(held(plain, "2027-01-01", "2027-12-31"));
  });

  it.each([
    ["8/2", eight, 2],
    ["6/2", eight.slice(0, 6), 2],
    ["8/3", eight, 3],
  ])("makes up a three-week absence within the year (%s)", (_, members, perShift) => {
    const a = members[1];
    const r = rule([{ userId: a, from: "2027-05-01", to: "2027-05-23" }], { memberIds: members, perShift });
    const counts = [...held(r, "2027-01-01", "2027-12-31").values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(on(r, a, { from: "2027-05-01", to: "2027-05-23" })).toEqual([]);
  });

  it("keeps fairness with Verstärkte Tage and Schließtage", () => {
    const a = eight[3];
    const r = rule([{ userId: a, from: "2027-06-01", to: "2027-06-20" }], {
      reinforcedDates: [{ date: "2027-09-04", perShift: 4 }],
      closedDates: [{ date: "2027-08-14", reason: "Feiertag", source: "skip" }],
    });
    const counts = [...held(r, "2027-01-01", "2027-12-31").values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("resets the Konto at New Year (no make-up in the next year)", () => {
    const a = eight[4];
    const r = rule([{ userId: a, from: "2027-12-01", to: "2027-12-31" }]);
    const plain = rule([]);
    expect(on(r, a, { from: "2027-12-01", to: "2027-12-31" })).toEqual([]);
    // 2028 has 53 Saturdays, so who gets the extra Platz depends on the round order; no make-up means
    // e stays within what the plain plan gives anyone in 2028.
    const plainMax = Math.max(...held(plain, "2028-01-01", "2028-12-31").values());
    expect(held(r, "2028-01-01", "2028-12-31").get(a)!).toBeLessThanOrEqual(plainMax);
  });

  it.each(["a", "c", "e", "h"])("books a round crossing New Year in each duty's own year (absent %s)", (a) => {
    // From 2028-01-15 a round of four Saturdays runs Dec 16 – Jan 6.
    const range = { from: "2028-12-16", to: "2029-01-06" };
    const r = rule([{ userId: a, ...range }], { startDate: "2028-01-15" });
    expect(on(r, a, range)).toEqual([]);
    // Rounds: 2028-12-16..2029-01-06 (crosses New Year), full rounds from 2029-01-13 to 2029-12-08,
    // then 2029-12-15..2030-01-05 (crosses again). A seat lost on 2029-01-06 is a 2029 debt and is
    // made up in the round of 2029-01-13 (absent h), so from 2029-02-10 to 2029-12-08 (eleven full
    // rounds) everyone holds the same count. Plain rounds cross New Year, so an even count per
    // calendar year is the promise of yearlyFairness (SPEC 12.41), not of the Nachhol-Konto.
    expect(new Set(held(r, "2029-02-10", "2029-12-08").values()).size).toBe(1);
  });

  it("with yearly fairness the missed Platz flows into the Delta", () => {
    const a = eight[5];
    const r = rule([{ userId: a, from: "2027-12-04", to: "2027-12-31" }], { yearlyFairness: true, memberSince: {} });
    expect(on(r, a, { from: "2027-12-04", to: "2027-12-31" })).toEqual([]);
    const counts2028 = held(r, "2028-01-01", "2028-12-31");
    const others = [...counts2028.entries()].filter(([u]) => u !== a).map(([, c]) => c);
    expect(counts2028.get(a)!).toBeGreaterThanOrEqual(Math.max(...others));
  });

  it("leaves a Platz open when too few are available", () => {
    const six = eight.slice(0, 6);
    const absences = six.slice(0, 5).map((userId) => ({ userId, from: "2027-04-03", to: "2027-04-03" }));
    const duty = generateDuties(rule(absences, { memberIds: six }), "2027-04-03", "2027-04-03")[0];
    expect(duty.userIds).toEqual([six[5]]);
    expect(duty.capacity).toBe(2);
  });

  it("is deterministic", () => {
    const r = rule([{ userId: eight[6], from: "2027-02-01", to: "2027-02-20" }]);
    expect(generateDays(r, "2027-01-01", "2027-12-31")).toEqual(generateDays(r, "2027-01-01", "2027-12-31"));
  });
});
