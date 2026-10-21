import { describe, expect, it } from "vitest";
import { validateRange, validateRotationInput } from "@/lib/rotation/validate";

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
  skipDates: ["2026-12-26"],
};

describe("validateRotationInput", () => {
  it("accepts a valid rotation and trims the name", () => {
    const result = validateRotationInput({ ...valid, name: "  Samstagsdienst " });
    expect(result).toEqual({ ok: true, value: { ...valid, name: "Samstagsdienst" } });
  });

  it("defaults optional fields", () => {
    const { startOffset, skipDates, periodDays, ...rest } = valid;
    void startOffset; void skipDates; void periodDays;
    const result = validateRotationInput(rest);
    expect(result.ok && result.value).toMatchObject({ startOffset: 0, skipDates: [], periodDays: null });
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
    [{ skipDates: ["morgen"] }, "skipDates"],
  ])("rejects %o with %s", (patch, error) => {
    expect(validateRotationInput({ ...valid, ...patch })).toEqual({ ok: false, error });
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
