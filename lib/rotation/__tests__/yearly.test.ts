import { describe, expect, it } from "vitest";
import { compensationSeats, yearDeltaRows } from "@/lib/rotation/yearly";

const tally = (counts: Record<string, number>, firstDate: string | null = "2026-11-07") => ({
  counts: new Map(Object.entries(counts)),
  firstDate,
});

describe("yearDeltaRows", () => {
  it("is null without any duty in the counted year", () => {
    expect(yearDeltaRows(["a"], undefined, tally({}, null), undefined)).toBeNull();
  });

  it("subtracts the fewest Plätze of a full-year Teilnehmer and rounds partial places", () => {
    const rows = yearDeltaRows(["a", "b", "c"], undefined, tally({ a: 13, b: 12.4, c: 14 }), undefined)!;
    expect(rows.map((r) => [r.userId, r.held, r.autoDelta, r.delta])).toEqual([
      ["a", 13, 1, 1],
      ["b", 12, 0, 0],
      ["c", 14, 2, 2],
    ]);
  });

  it("gives later joiners Delta 0 and leaves them out of the minimum", () => {
    const rows = yearDeltaRows(["a", "b", "n"], { a: "2026-01-01", b: "2026-11-07", n: "2026-11-08" }, tally({ a: 3, b: 2, n: 0 }), undefined)!;
    expect(rows.map((r) => [r.userId, r.fullYear, r.autoDelta])).toEqual([
      ["a", true, 1],
      ["b", true, 0],
      ["n", false, 0],
    ]);
  });

  it("gives everybody 0 without a full-year Teilnehmer", () => {
    const rows = yearDeltaRows(["a"], { a: "2026-12-01" }, tally({ a: 4 }), undefined)!;
    expect(rows[0]).toMatchObject({ fullYear: false, autoDelta: 0, delta: 0 });
  });

  it("lets an override replace the automatic value, also for later joiners", () => {
    const rows = yearDeltaRows(["a", "n"], { n: "2026-12-01" }, tally({ a: 2, n: 1 }), { a: 3, n: 1 })!;
    expect(rows.map((r) => [r.userId, r.autoDelta, r.override, r.delta])).toEqual([
      ["a", 0, 3, 3],
      ["n", 0, 1, 1],
    ]);
  });

  it("counts a Teilnehmer missing from the tally as 0", () => {
    const rows = yearDeltaRows(["a", "b"], undefined, tally({ a: 2 }), undefined)!;
    expect(rows.map((r) => r.autoDelta)).toEqual([2, 0]);
  });
});

describe("compensationSeats", () => {
  it("gives everyone maxDelta − delta seats, smallest Delta first in every pass", () => {
    const deltas = new Map([["c", 2], ["a", 1]]);
    expect(compensationSeats(["a", "b", "c", "d"], deltas)).toEqual(["b", "d", "a", "b", "d"]);
  });

  it("is empty when all Deltas are equal", () => {
    expect(compensationSeats(["a", "b"], new Map([["a", 1], ["b", 1]]))).toEqual([]);
    expect(compensationSeats(["a", "b"], new Map())).toEqual([]);
  });
});
