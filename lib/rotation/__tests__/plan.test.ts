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
  presetId: "p1",
  signupCapacity: 2,
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
      presetId: "p1",
      perShift: 2,
      now,
    });
    expect(plan.entries).toEqual([{ kind: "create", date: "2026-11-07", userIds: ["a", "b"], capacity: 2 }]);
    expect(plan.warnings).toEqual([]);
  });

  it("is idempotent: identical state yields only unchanged entries", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-11-07", userIds: ["a", "b"] }],
      existing: [existing("2026-11-07", [slot("a"), slot("b")])],
      template,
      memberIds: members,
      presetId: "p1",
      perShift: 2,
      now,
    });
    expect(plan.entries).toEqual([
      { kind: "unchanged", shiftId: "s-2026-11-07", date: "2026-11-07", userIds: ["a", "b"], locked: [], capacity: 2 },
    ]);
  });

  it("keeps a locked slot and does not re-add the replaced Teilnehmer", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-11-07", userIds: ["a", "b"] }],
      existing: [existing("2026-11-07", [slot("c", true, "a"), slot("b")])],
      template,
      memberIds: members,
      presetId: "p1",
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
      presetId: "p1",
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
      presetId: "p1",
      perShift: 2,
      now,
    });
    expect(plan.entries[0]).toMatchObject({ kind: "update", add: [], remove: [], fieldsChanged: true });
  });

  it("flags capacity mismatch", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-11-07", userIds: ["a", "b"] }],
      existing: [existing("2026-11-07", [slot("a"), slot("b")], { signupCapacity: 3 })],
      template,
      presetId: "p1",
      memberIds: members,
      perShift: 2,
      now,
    });
    expect(plan.entries[0]).toMatchObject({ kind: "update", add: [], remove: [], fieldsChanged: false, capacityChanged: true });
  });

  it("flags preset mismatch", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-11-07", userIds: ["a", "b"] }],
      existing: [existing("2026-11-07", [slot("a"), slot("b")], { presetId: "p-old" })],
      template,
      presetId: "p1",
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
      presetId: "p1",
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
      presetId: "p1",
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
      presetId: "p1",
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
      presetId: "p1",
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
      presetId: "p1",
      perShift: 2,
      now,
    });
    expect(plan.entries[0]).toMatchObject({ kind: "update", add: [], remove: [], fieldsChanged: true });
  });
});

describe("capacity per duty", () => {
  it("creates a verstärkter Dienst with its capacity", () => {
    const plan = planGeneration({
      desired: [{ date: "2026-12-19", userIds: ["a", "b", "c"], capacity: 3 }],
      existing: [],
      template,
      presetId: "p1",
      memberIds: ["a", "b", "c", "d"],
      perShift: 2,
      now,
    });
    expect(plan.entries).toEqual([{ kind: "create", date: "2026-12-19", userIds: ["a", "b", "c"], capacity: 3 }]);
  });

  it("updates the capacity when a verstärkter Tag is added to an existing duty", () => {
    const current = existing("2026-12-19", [slot("a"), slot("b")], { signupCapacity: 2 });
    const [entry] = planGeneration({ desired: [{ date: "2026-12-19", userIds: ["a", "b", "c"], capacity: 3 }], existing: [current], template, presetId: "p1", memberIds: ["a", "b", "c", "d"], perShift: 2, now }).entries;
    expect(entry).toMatchObject({ kind: "update", capacity: 3, add: ["c"], remove: [], fieldsChanged: false, capacityChanged: true });
  });

  it("reports a field change apart from a capacity change", () => {
    const current = existing("2026-12-19", [slot("a"), slot("b")], { signupCapacity: 2, notes: "old" });
    const [entry] = planGeneration({ desired: [{ date: "2026-12-19", userIds: ["a", "b"], capacity: 2 }], existing: [current], template, presetId: "p1", memberIds: ["a", "b", "c", "d"], perShift: 2, now }).entries;
    expect(entry).toMatchObject({ kind: "update", fieldsChanged: true, capacityChanged: false });
  });

  it("keeps locked Plätze over a shrunk capacity and warns", () => {
    const current = existing("2026-12-19", ["a", "b", "c"].map((id) => slot(id, true)), { signupCapacity: 3 });
    const plan = planGeneration({ desired: [{ date: "2026-12-19", userIds: ["a", "b"], capacity: 2 }], existing: [current], template, presetId: "p1", memberIds: ["a", "b", "c", "d"], perShift: 2, now });
    expect(plan.entries[0]).toMatchObject({ kind: "unchanged", capacity: 3, userIds: ["a", "b", "c"] });
    expect(plan.warnings).toEqual([{ kind: "lockedOverCapacity", shiftId: current.shiftId, date: "2026-12-19", userIds: ["a", "b", "c"], capacity: 2 }]);
  });
});
