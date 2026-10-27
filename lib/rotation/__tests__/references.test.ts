// [fork] Tests for the Feiertagskalender branches of checkRotationReferences().
import { beforeEach, describe, expect, it } from "vitest";
import { checkRotationReferences } from "@/lib/rotation/references";
import type { RotationInput } from "@/lib/rotation/validate";
import { createUser, seedHolidays, seedTeam } from "@/tests/helpers/seed";

let team: ReturnType<typeof seedTeam>;
let input: RotationInput;

beforeEach(() => {
  team = seedTeam({ members: 2 });
  input = {
    name: "Samstagsdienst",
    calendarId: team.calendarId,
    presetId: team.presetId,
    memberIds: team.memberIds,
    perShift: 1,
    period: "week",
    periodDays: null,
    startDate: "2026-11-02",
    startOffset: 0,
    weekdays: [6],
    skipDates: [],
    closedTitle: "Geschlossen",
    holidayCalendarId: null,
    holidayOpenDates: [],
    entryTitle: "{Vorname} Dienst",
    reinforcedDates: [],
  };
});

describe("checkRotationReferences – Feiertagskalender", () => {
  it("accepts a calendar the actor can view", async () => {
    const holidays = seedHolidays(team.ownerId, []);
    expect(await checkRotationReferences({ ...input, holidayCalendarId: holidays }, team.ownerId)).toBeNull();
  });

  it("rejects the team calendar itself", async () => {
    expect(await checkRotationReferences({ ...input, holidayCalendarId: team.calendarId }, team.ownerId)).toBe(
      "holidayCalendarSame"
    );
  });

  it("rejects the team calendar itself even when unchanged", async () => {
    expect(
      await checkRotationReferences({ ...input, holidayCalendarId: team.calendarId }, team.ownerId, team.calendarId)
    ).toBe("holidayCalendarSame");
  });

  it("rejects a missing calendar", async () => {
    expect(await checkRotationReferences({ ...input, holidayCalendarId: crypto.randomUUID() }, team.ownerId)).toBe(
      "holidayCalendar"
    );
  });

  it("rejects a newly chosen calendar the actor cannot view", async () => {
    const foreign = seedHolidays(createUser("Fremd"), []);
    expect(await checkRotationReferences({ ...input, holidayCalendarId: foreign }, team.ownerId, null)).toBe(
      "holidayCalendar"
    );
  });

  it("passes an unchanged calendar the actor cannot view (co-manager saves)", async () => {
    const foreign = seedHolidays(createUser("Fremd"), []);
    expect(await checkRotationReferences({ ...input, holidayCalendarId: foreign }, team.ownerId, foreign)).toBeNull();
  });
});
