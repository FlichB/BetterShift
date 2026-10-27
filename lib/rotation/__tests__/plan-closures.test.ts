// [fork] Tests for planClosures().
import { describe, expect, it } from "vitest";
import { planClosures, type ExistingClosure } from "@/lib/rotation/plan";
import { CLOSURE_FIELDS } from "@/lib/rotation/closures";

const now = new Date(2026, 10, 1, 12, 0); // 2026-11-01 12:00
const existing = (date: string, title: string, over: Partial<ExistingClosure> = {}): ExistingClosure => ({
  shiftId: `c-${date}`,
  date,
  title,
  presetId: null,
  signupCapacity: 0,
  ...CLOSURE_FIELDS,
  ...over,
});
const base = { closedTitle: "Geschlossen", blockedDates: [] as string[], now };

describe("planClosures", () => {
  it("creates a missing Schließeintrag", () => {
    expect(planClosures({ ...base, desired: [{ date: "2026-11-14", reason: "Inventur", source: "skip" }], existing: [] })).toEqual([
      { kind: "create", date: "2026-11-14", title: "Geschlossen (Inventur)", source: "skip" },
    ]);
  });

  it("leaves an identical one unchanged", () => {
    const plan = planClosures({
      ...base,
      desired: [{ date: "2026-11-14", reason: "Inventur", source: "skip" }],
      existing: [existing("2026-11-14", "Geschlossen (Inventur)")],
    });
    expect(plan).toEqual([{ kind: "unchanged", shiftId: "c-2026-11-14", date: "2026-11-14", title: "Geschlossen (Inventur)", source: "skip" }]);
  });

  it("updates a changed reason or changed fixed fields", () => {
    const plan = planClosures({
      ...base,
      desired: [
        { date: "2026-11-14", reason: "Umbau", source: "skip" },
        { date: "2026-11-21", reason: "Inventur", source: "skip" },
      ],
      existing: [existing("2026-11-14", "Geschlossen (Inventur)"), existing("2026-11-21", "Geschlossen (Inventur)", { color: "#000000" })],
    });
    expect(plan.map((e) => e.kind)).toEqual(["update", "update"]);
    expect(plan[0]).toMatchObject({ title: "Geschlossen (Umbau)" });
  });

  it("deletes a Schließeintrag that is no longer wanted", () => {
    expect(planClosures({ ...base, desired: [], existing: [existing("2026-11-14", "Geschlossen (Inventur)")] })).toEqual([
      { kind: "delete", shiftId: "c-2026-11-14", date: "2026-11-14", title: "Geschlossen (Inventur)" },
    ]);
  });

  it("skips dates where a duty with locked Plätze stays", () => {
    const plan = planClosures({ ...base, blockedDates: ["2026-11-14"], desired: [{ date: "2026-11-14", reason: "Inventur", source: "skip" }], existing: [] });
    expect(plan).toEqual([]);
  });

  it("never plans a started day", () => {
    const plan = planClosures({
      ...base,
      desired: [{ date: "2026-11-01", reason: "Inventur", source: "skip" }],
      existing: [existing("2026-10-31", "Geschlossen (Alt)")],
    });
    expect(plan).toEqual([]);
  });
});
