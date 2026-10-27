import { describe, expect, it } from "vitest";
import { checkPastReinforcedDates, validateRange, validateRotationInput } from "@/lib/rotation/validate";

const valid = {
  name: "Samstagsdienst",
  calendarId: "cal",
  presetId: "preset",
  memberIds: ["a", "b", "c", "d"],
  perShift: 2,
  period: "week",
  periodDays: null,
  startDate: "2026-11-02",
  startOffset: 0,
  weekdays: [6],
  skipDates: [{ date: "2026-12-26", reason: "Inventur" }],
  closedTitle: "HeimkinoWelt geschlossen",
  holidayCalendarId: "holidays",
  holidayOpenDates: ["2026-12-08"],
  entryTitle: "{Vorname} Dienst",
  reinforcedDates: [] as { date: string; perShift: number }[],
};

describe("validateRotationInput", () => {
  it("accepts a valid rotation and trims the name", () => {
    const result = validateRotationInput({ ...valid, name: "  Samstagsdienst " });
    expect(result).toEqual({ ok: true, value: { ...valid, name: "Samstagsdienst" } });
  });

  it("defaults optional fields", () => {
    const { startOffset, skipDates, periodDays, closedTitle, holidayCalendarId, holidayOpenDates, ...rest } = valid;
    void startOffset; void skipDates; void periodDays; void closedTitle; void holidayCalendarId; void holidayOpenDates;
    const result = validateRotationInput(rest);
    expect(result.ok && result.value).toMatchObject({
      startOffset: 0,
      skipDates: [],
      periodDays: null,
      closedTitle: "Geschlossen",
      holidayCalendarId: null,
      holidayOpenDates: [],
    });
  });

  it.each([
    [{ name: "" }, "name"],
    [{ name: "x".repeat(101) }, "name"],
    [{ calendarId: 1 }, "calendarId"],
    [{ presetId: "" }, "presetId"],
    [{ memberIds: ["a", "a", "b"] }, "members"],
    [{ memberIds: ["a"] }, "members"],
    [{ perShift: 0 }, "perShift"],
    [{ perShift: 1.5 }, "perShift"],
    [{ period: "month" }, "period"],
    [{ period: "days", periodDays: null }, "periodDays"],
    [{ period: "days", periodDays: 400 }, "periodDays"],
    [{ startDate: "2026-02-30" }, "startDate"],
    [{ startOffset: 4 }, "startOffset"],
    [{ weekdays: [0] }, "weekdays"],
    [{ weekdays: [6, 6] }, "weekdays"],
    [{ skipDates: ["2026-12-26"] }, "skipDates"],
    [{ skipDates: [{ date: "morgen", reason: "x" }] }, "skipDates"],
    [{ skipDates: [{ date: "2026-12-26", reason: " " }] }, "skipDates"],
    [{ skipDates: [{ date: "2026-12-26", reason: "x".repeat(101) }] }, "skipDates"],
    [{ closedTitle: "" }, "closedTitle"],
    [{ closedTitle: "x".repeat(101) }, "closedTitle"],
    [{ holidayCalendarId: 5 }, "holidayCalendar"],
    [{ holidayOpenDates: ["2026-02-30"] }, "holidayOpenDates"],
  ])("rejects %o with %s", (patch, error) => {
    expect(validateRotationInput({ ...valid, ...patch })).toEqual({ ok: false, error });
  });

  it("sorts Ausfalltage, trims reasons and keeps the last entry per date", () => {
    const result = validateRotationInput({
      ...valid,
      skipDates: [
        { date: "2026-12-31", reason: " Silvester " },
        { date: "2026-12-24", reason: "Heiligabend" },
        { date: "2026-12-31", reason: "Jahresabschluss" },
      ],
    });
    expect(result.ok && result.value.skipDates).toEqual([
      { date: "2026-12-24", reason: "Heiligabend" },
      { date: "2026-12-31", reason: "Jahresabschluss" },
    ]);
  });

  it("ignores periodDays unless period is days", () => {
    const result = validateRotationInput({ ...valid, periodDays: 5 });
    expect(result.ok && result.value.periodDays).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(validateRotationInput(null)).toEqual({ ok: false, error: "name" });
  });
});

describe("validateRange", () => {
  it("accepts up to 366 days", () => {
    expect(validateRange({ from: "2026-11-01", to: "2027-11-01" })).toEqual({
      ok: true,
      value: { from: "2026-11-01", to: "2027-11-01" },
    });
  });

  it.each([
    [{ from: "2026-11-02", to: "2026-11-01" }],
    [{ from: "2026-11-01", to: "2027-11-03" }],
    [{ from: "x", to: "2026-11-01" }],
    [{}],
  ])("rejects %o", (body) => {
    expect(validateRange(body)).toEqual({ ok: false, error: "range" });
  });
});

describe("entryTitle", () => {
  it("defaults to the standard template and trims", () => {
    const withoutTitle: Record<string, unknown> = { ...valid };
    delete withoutTitle.entryTitle;
    const result = validateRotationInput(withoutTitle);
    expect(result.ok && result.value.entryTitle).toBe("{Vorname} Dienst");
    const trimmed = validateRotationInput({ ...valid, entryTitle: "  {Name}  " });
    expect(trimmed.ok && trimmed.value.entryTitle).toBe("{Name}");
  });

  it("rejects invalid templates", () => {
    for (const entryTitle of ["{Dienst}", "{Datum} {Name}", "", 42]) {
      expect(validateRotationInput({ ...valid, entryTitle })).toEqual({ ok: false, error: "entryTitle" });
    }
  });
});

describe("reinforcedDates", () => {
  const today = "2026-11-01";
  const check = (reinforcedDates: unknown, patch: object = {}) =>
    validateRotationInput({ ...valid, memberIds: ["u1", "u2", "u3", "u4"], perShift: 2, ...patch, reinforcedDates }, today);

  it("defaults to none and sorts by date", () => {
    const body: Record<string, unknown> = { ...valid };
    delete body.reinforcedDates;
    const none = validateRotationInput(body, today);
    expect(none.ok && none.value.reinforcedDates).toEqual([]);
    const sorted = check([{ date: "2026-12-19", perShift: 3 }, { date: "2026-12-05", perShift: 4 }]);
    expect(sorted.ok && sorted.value.reinforcedDates).toEqual([{ date: "2026-12-05", perShift: 4 }, { date: "2026-12-19", perShift: 3 }]);
  });

  it("rejects future entries that are not above perShift or above the Teilnehmer count", () => {
    expect(check([{ date: "2026-12-19", perShift: 2 }])).toEqual({ ok: false, error: "reinforcedDates" });
    expect(check([{ date: "2026-12-19", perShift: 5 }])).toEqual({ ok: false, error: "reinforcedDates" });
    expect(check([{ date: "2026-12-19", perShift: 3 }], { perShift: 3 })).toEqual({ ok: false, error: "reinforcedDates" });
  });

  it("rejects malformed and duplicate entries", () => {
    for (const bad of [[{ date: "2026-13-01", perShift: 3 }], [{ date: "2026-12-19", perShift: 2.5 }], ["2026-12-19"], [{ date: "2026-12-19", perShift: 3 }, { date: "2026-12-19", perShift: 4 }]]) {
      expect(check(bad)).toEqual({ ok: false, error: "reinforcedDates" });
    }
  });

  it("keeps past entries even when they no longer fit", () => {
    const result = check([{ date: "2026-10-03", perShift: 6 }]);
    expect(result.ok && result.value.reinforcedDates).toEqual([{ date: "2026-10-03", perShift: 6 }]);
  });
});

describe("checkPastReinforcedDates", () => {
  const today = "2026-11-01";
  const stored = [
    { date: "2026-10-03", perShift: 3 },
    { date: "2026-10-17", perShift: 4 },
    { date: "2026-12-19", perShift: 3 },
  ];

  it("rejects removing a past entry", () => {
    expect(checkPastReinforcedDates(stored, [stored[1], stored[2]], today)).toBe("reinforcedDates");
  });

  it("rejects changing a past entry's size", () => {
    expect(checkPastReinforcedDates(stored, [{ ...stored[0], perShift: 4 }, stored[1], stored[2]], today)).toBe(
      "reinforcedDates"
    );
  });

  it("rejects adding a past entry", () => {
    expect(checkPastReinforcedDates(stored, [stored[0], { date: "2026-10-10", perShift: 3 }, stored[1], stored[2]], today)).toBe(
      "reinforcedDates"
    );
  });

  it("accepts unchanged past entries with new or changed future ones", () => {
    expect(checkPastReinforcedDates(stored, [stored[0], stored[1], { date: "2026-11-01", perShift: 3 }], today)).toBeNull();
  });
});
