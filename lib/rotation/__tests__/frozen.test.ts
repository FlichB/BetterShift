// [fork] Urlaub: replanning from a date keeps the duties before it (frozenBefore, final review C1).
import { describe, expect, it } from "vitest";
import { generateDuties } from "@/lib/rotation/generate";
import type { Absence, PlannedDuty, RotationRule } from "@/lib/rotation/types";

const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];

// Saturdays from 2027-01-02, 2 per duty: rounds of four duties (Jan 2–23, Jan 30–Feb 20, …).
const base: RotationRule = {
  memberIds: eight,
  perShift: 2,
  period: "week",
  periodDays: null,
  startDate: "2027-01-01",
  startOffset: 0,
  weekdays: [6],
  closedDates: [],
  openHolidays: [],
  reinforcedDates: [],
};

const plan = (r: RotationRule, from = "2027-01-01", to = "2027-12-31") => generateDuties(r, from, to);
const asHeld = (duties: PlannedDuty[], before: string) =>
  Object.fromEntries(duties.filter((d) => d.date < before).map((d) => [d.date, d.userIds]));
const replan = (absences: Absence[], before: string, written: PlannedDuty[]): RotationRule => ({
  ...base,
  absences,
  frozenBefore: before,
  frozenDuties: asHeld(written, before),
});
const counts = (duties: PlannedDuty[]) => {
  const map = new Map(eight.map((u) => [u, 0]));
  for (const d of duties) for (const u of d.userIds) map.set(u, (map.get(u) as number) + 1);
  return map;
};
const groupsBefore = (duties: PlannedDuty[], before: string) => duties.filter((d) => d.date < before).map((d) => [d.date, d.userIds]);

describe("frozen prefix", () => {
  const written = plan(base);

  it("is ignored without absences", () => {
    expect(plan({ ...base, frozenBefore: "2027-03-01", frozenDuties: { "2027-01-02": ["g", "h"] } })).toEqual(written);
  });

  it("keeps the round before the vacation as written (reviewer probe: a off on 2027-02-06)", () => {
    const vacation = [{ userId: "a", from: "2027-02-06", to: "2027-02-06" }];
    expect(written.find((d) => d.date === "2027-02-06")?.userIds).toContain("a");
    // Without the frozen prefix the round's earlier duty 2027-01-30 changes, which a replan never writes.
    const unfrozen = plan({ ...base, absences: vacation });
    expect(groupsBefore(unfrozen, "2027-02-06")).not.toEqual(groupsBefore(written, "2027-02-06"));

    const result = plan(replan(vacation, "2027-02-06", written));
    expect(groupsBefore(result, "2027-02-06")).toEqual(groupsBefore(written, "2027-02-06"));
    expect(result.find((d) => d.date === "2027-02-06")?.userIds).not.toContain("a");
    expect(counts(result)).toEqual(counts(written)); // 13 each
  });

  it("gives a substitute and makes the Platz up later when no later duty of the round can take the swap", () => {
    // 2027-02-20 is the last duty of its round, so the only swaps would go into frozen duties.
    const day = "2027-02-20";
    const absent = written.find((d) => d.date === day)!.userIds[0];
    const result = plan(replan([{ userId: absent, from: day, to: day }], day, written));

    expect(groupsBefore(result, day)).toEqual(groupsBefore(written, day));
    const duty = result.find((d) => d.date === day)!;
    expect(duty.userIds).toHaveLength(2);
    expect(duty.userIds).not.toContain(absent);
    // The Nachholplatz: a later duty of 2027 where the absent person sits and did not before.
    const madeUp = result.filter((d) => d.date > day && d.userIds.includes(absent) && !written.find((w) => w.date === d.date)!.userIds.includes(absent));
    expect(madeUp.length).toBeGreaterThan(0);
    expect(counts(result).get(absent)).toBe(counts(written).get(absent));
    const all = [...counts(result).values()];
    expect(Math.max(...all) - Math.min(...all)).toBeLessThanOrEqual(1);
  });

  it("still makes up a missed Platz when a later replan freezes the vacation but not the Nachholplatz", () => {
    const day = "2027-02-20";
    const absent = written.find((d) => d.date === day)!.userIds[0];
    const first = [{ userId: absent, from: day, to: day }];
    const afterFirst = plan(replan(first, day, written));
    const madeUpOn = afterFirst.find((d) => d.date > day && d.userIds.includes(absent) && !written.find((w) => w.date === d.date)!.userIds.includes(absent))!.date;

    // A second vacation, of someone else in June, replans from the Nachholplatz on.
    const other = eight.find((u) => u !== absent && !afterFirst.find((d) => d.date === day)!.userIds.includes(u))!;
    const second = [...first, { userId: other, from: "2027-06-05", to: "2027-06-05" }];
    const result = plan(replan(second, madeUpOn, afterFirst));

    expect(groupsBefore(result, madeUpOn)).toEqual(groupsBefore(afterFirst, madeUpOn));
    expect(result.find((d) => d.date === "2027-06-05")?.userIds).not.toContain(other);
    expect(counts(result).get(absent)).toBe(counts(written).get(absent));
    const all = [...counts(result).values()];
    expect(Math.max(...all) - Math.min(...all)).toBeLessThanOrEqual(1);

    // Frozen past the Nachholplatz too: the Platz is not made up a second time.
    const later = plan(replan(second, "2027-05-01", afterFirst));
    expect(groupsBefore(later, "2027-05-01")).toEqual(groupsBefore(afterFirst, "2027-05-01"));
    expect(counts(later)).toEqual(counts(written));
  });

  it("does not make up a Platz twice when the next vacation falls in the round of the Nachholplatz", () => {
    const day = "2027-02-20";
    const absent = written.find((d) => d.date === day)!.userIds[0];
    const first = [{ userId: absent, from: day, to: day }];
    const afterFirst = plan(replan(first, day, written));
    const madeUpOn = afterFirst.find((d) => d.date > day && d.userIds.includes(absent) && !written.find((w) => w.date === d.date)!.userIds.includes(absent))!.date;
    // Every later duty of that round, with someone else on vacation there.
    for (const duty of afterFirst.filter((d) => d.date > madeUpOn && d.date <= "2027-03-20")) {
      const other = duty.userIds.find((u) => u !== absent)!;
      const second = [...first, { userId: other, from: duty.date, to: duty.date }];
      const result = plan(replan(second, duty.date, afterFirst));
      expect(groupsBefore(result, duty.date)).toEqual(groupsBefore(afterFirst, duty.date));
      expect(result.find((d) => d.date === duty.date)?.userIds).not.toContain(other);
      expect(counts(result).get(absent)).toBe(counts(written).get(absent));
      const all = [...counts(result).values()];
      expect(Math.max(...all) - Math.min(...all)).toBeLessThanOrEqual(1);
    }
  });

  it("counts a frozen Nachholplatz in a round the generator would arrange differently", () => {
    const day = "2027-02-20";
    const absent = written.find((d) => d.date === day)!.userIds[0];
    const first = [{ userId: absent, from: day, to: day }];
    const afterFirst = plan(replan(first, day, written));
    const madeUpOn = afterFirst.find((d) => d.date > day && d.userIds.includes(absent) && !written.find((w) => w.date === d.date)!.userIds.includes(absent))!.date;
    // Two other duties of the Nachholplatz's round swap a partner (by hand, say), so the generator
    // would not arrange that round like this; the Nachholplatz in it still counts.
    const round = afterFirst.filter((d) => d.date >= "2027-02-27" && d.date <= "2027-03-20" && d.date !== madeUpOn && !d.userIds.includes(absent));
    const [x, y] = [round[0], round[1]];
    const edited = afterFirst.map((d) =>
      d === x ? { ...d, userIds: [x.userIds[0], y.userIds[1]].sort() } : d === y ? { ...d, userIds: [y.userIds[0], x.userIds[1]].sort() } : d
    );
    const result = plan(replan(first, "2027-04-01", edited));
    expect(groupsBefore(result, "2027-04-01")).toEqual(groupsBefore(edited, "2027-04-01"));
    expect(counts(result)).toEqual(counts(written));
  });

  it("changes nothing when the frozen duties are what the generator plans anyway", () => {
    const vacation = [{ userId: "c", from: "2027-06-01", to: "2027-06-30" }];
    const unfrozen = plan({ ...base, absences: vacation });
    expect(plan(replan(vacation, "2027-05-01", unfrozen))).toEqual(unfrozen);
  });
});
