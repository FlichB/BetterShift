import { describe, expect, it } from "vitest";
import { planGeneration, type DutyTemplate, type ExistingDuty } from "@/lib/rotation/plan";

const template: DutyTemplate = {
  title: "Samstagsdienst",
  startTime: "09:30",
  endTime: "15:00",
  color: "#3b82f6",
  isAllDay: false,
  notes: null,
};
const now = new Date(2026, 10, 1, 12, 0); // 2026-11-01 12:00
const members = ["a", "b", "c", "d"];

const existing = (date: string, slots: ExistingDuty["slots"], over: Partial<ExistingDuty> = {}): ExistingDuty => ({
  shiftId: `s-${date}`,
  date,
  slots,
  ...template,
  ...over,
});
const slot = (userId: string, locked = false, replacesUserId: string | null = null) => ({
  userId,
  locked,
  replacesUserId,
});

describe("planGeneration", () => {
  it("creates missing duties", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-11-07", userIds: ["a", "b"] }],
      existing: [],
      template,
      memberIds: members,
      perShift: 2,
      now,
    });
    expect(plan.entries).toEqual([{ kind: "create", date: "2026-11-07", userIds: ["a", "b"] }]);
    expect(plan.warnings).toEqual([]);
  });

  it("is idempotent: identical state yields only unchanged entries", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-11-07", userIds: ["a", "b"] }],
      existing: [existing("2026-11-07", [slot("a"), slot("b")])],
      template,
      memberIds: members,
      perShift: 2,
      now,
    });
    expect(plan.entries).toEqual([
      { kind: "unchanged", shiftId: "s-2026-11-07", date: "2026-11-07", userIds: ["a", "b"], locked: [] },
    ]);
  });

  it("keeps a locked slot and does not re-add the replaced Teilnehmer", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-11-07", userIds: ["a", "b"] }],
      existing: [existing("2026-11-07", [slot("c", true, "a"), slot("b")])],
      template,
      memberIds: members,
      perShift: 2,
      now,
    });
    expect(plan.entries[0]).toMatchObject({ kind: "unchanged", userIds: ["c", "b"], locked: ["c"] });
  });

  it("overwrites manual changes on unlocked slots", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-11-07", userIds: ["a", "b"] }],
      existing: [existing("2026-11-07", [slot("a"), slot("d")])],
      template,
      memberIds: members,
      perShift: 2,
      now,
    });
    expect(plan.entries[0]).toMatchObject({ kind: "update", add: ["b"], remove: ["d"], userIds: ["a", "b"] });
  });

  it("flags preset changes", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-11-07", userIds: ["a", "b"] }],
      existing: [existing("2026-11-07", [slot("a"), slot("b")], { endTime: "14:00" })],
      template,
      memberIds: members,
      perShift: 2,
      now,
    });
    expect(plan.entries[0]).toMatchObject({ kind: "update", add: [], remove: [], fieldsChanged: true });
  });

  it("deletes unlocked duties that are no longer planned, keeps locked ones with a warning", () => {
    const plan = planGeneration({
      desired: [],
      existing: [
        existing("2026-11-07", [slot("a"), slot("b")]),
        existing("2026-11-14", [slot("c", true, "a"), slot("d")]),
      ],
      template,
      memberIds: members,
      perShift: 2,
      now,
    });
    expect(plan.entries).toEqual([
      { kind: "delete", shiftId: "s-2026-11-07", date: "2026-11-07", userIds: ["a", "b"] },
    ]);
    expect(plan.warnings).toEqual([
      { kind: "lockedWithoutDuty", shiftId: "s-2026-11-14", date: "2026-11-14", userIds: ["c"] },
    ]);
  });

  it("warns about locked slots of former Teilnehmer", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-11-07", userIds: ["a", "b"] }],
      existing: [existing("2026-11-07", [slot("x", true, "a"), slot("b")])],
      template,
      memberIds: members,
      perShift: 2,
      now,
    });
    expect(plan.warnings).toEqual([
      { kind: "lockedNonMember", shiftId: "s-2026-11-07", date: "2026-11-07", userId: "x" },
    ]);
  });

  it("never touches started duties", () => {
    const plan = planGeneration({
      desired: [
        { date: "2026-10-31", userIds: ["a", "b"] },
        { date: "2026-11-01", userIds: ["a", "b"] }, // 09:30 < 12:00 → started
      ],
      existing: [existing("2026-10-31", [slot("c"), slot("d")])],
      template,
      memberIds: members,
      perShift: 2,
      now,
    });
    expect(plan.entries).toEqual([]);
  });

  it("sorts entries by date", () => {
    const plan = planGeneration({
      desired: [
        { date: "2026-11-14", userIds: ["c", "d"] },
        { date: "2026-11-07", userIds: ["a", "b"] },
      ],
      existing: [existing("2026-11-21", [slot("a"), slot("b")])],
      template,
      memberIds: members,
      perShift: 2,
      now,
    });
    expect(plan.entries.map((e) => e.date)).toEqual(["2026-11-07", "2026-11-14", "2026-11-21"]);
  });
});

describe("planGeneration notes", () => {
  it("flags changed preset notes", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-11-07", userIds: ["a", "b"] }],
      existing: [existing("2026-11-07", [slot("a"), slot("b")], { notes: "old" })],
      template,
      memberIds: members,
      perShift: 2,
      now,
    });
    expect(plan.entries[0]).toMatchObject({ kind: "update", add: [], remove: [], fieldsChanged: true });
  });
});
