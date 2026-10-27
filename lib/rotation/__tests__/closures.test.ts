import { describe, expect, it } from "vitest";
import { closureTitle, resolveClosedDates } from "@/lib/rotation/closures";

describe("resolveClosedDates", () => {
  it("closes Feiertage with their name", () => {
    expect(resolveClosedDates([], [{ date: "2029-12-08", name: "Mariä Empfängnis" }], [])).toEqual({
      closedDates: [{ date: "2029-12-08", reason: "Mariä Empfängnis", source: "holiday" }],
      openHolidays: [],
    });
  });

  it("keeps a Geöffneter Feiertag open", () => {
    expect(resolveClosedDates([], [{ date: "2029-12-08", name: "Mariä Empfängnis" }], ["2029-12-08"])).toEqual({
      closedDates: [],
      openHolidays: [{ date: "2029-12-08", name: "Mariä Empfängnis" }],
    });
  });

  it("lets an Ausfalltag win over a Feiertag, even an opened one", () => {
    const result = resolveClosedDates(
      [{ date: "2029-12-08", reason: "Inventur" }],
      [{ date: "2029-12-08", name: "Mariä Empfängnis" }],
      ["2029-12-08"]
    );
    expect(result).toEqual({ closedDates: [{ date: "2029-12-08", reason: "Inventur", source: "skip" }], openHolidays: [] });
  });

  it("joins several entries of one day, drops blanks and duplicates, sorts by date", () => {
    const result = resolveClosedDates(
      [{ date: "2027-01-02", reason: "Inventur" }],
      [
        { date: "2026-12-26", name: "Stefanitag" },
        { date: "2026-12-26", name: " " },
        { date: "2026-12-26", name: "Firmenfeier" },
        { date: "2026-12-26", name: "Stefanitag" },
      ],
      []
    );
    expect(result.closedDates).toEqual([
      { date: "2026-12-26", reason: "Stefanitag, Firmenfeier", source: "holiday" },
      { date: "2027-01-02", reason: "Inventur", source: "skip" },
    ]);
  });
});

describe("closureTitle", () => {
  it("puts the reason in brackets", () => {
    expect(closureTitle("HeimkinoWelt geschlossen", "Mariä Empfängnis")).toBe("HeimkinoWelt geschlossen (Mariä Empfängnis)");
  });
});
