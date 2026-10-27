import { describe, expect, it } from "vitest";
import { createRotation, runGeneration } from "@/lib/rotation/service";
import { setOutlookEnabled } from "@/lib/outlook/rotation";
import { loadDesiredDuties } from "@/lib/outlook/sync";
import { desiredEvents } from "@/lib/outlook/desired";
import { loadPersonalDuties } from "@/lib/feed/personal";
import { seedTeam } from "@/tests/helpers/seed";

const now = new Date(2026, 9, 21, 12, 0);

describe("Schließeinträge in Outlook and the personal feed", () => {
  it("become an all-day event without attendees and stay out of the feed", async () => {
    const team = seedTeam();
    const rotation = createRotation(
      {
        name: "Samstagsdienst",
        calendarId: team.calendarId,
        presetId: team.presetId,
        memberIds: team.memberIds,
        perShift: 2,
        period: "week",
        periodDays: null,
        startDate: "2026-11-02",
        startOffset: 0,
        weekdays: [6],
        skipDates: [{ date: "2026-11-14", reason: "Inventur" }],
        closedTitle: "HeimkinoWelt geschlossen",
        entryTitle: "{Vorname} Dienst",
        reinforcedDates: [],
        holidayCalendarId: null,
        holidayOpenDates: [],
      },
      team.ownerId
    );
    await runGeneration(rotation.id, "2026-11-02", "2026-11-28", team.ownerId, now);
    setOutlookEnabled(rotation.id, true);

    const closure = loadDesiredDuties(now, rotation.id).find((d) => d.date === "2026-11-14")!;
    expect(closure).toMatchObject({ title: "HeimkinoWelt geschlossen (Inventur)", isAllDay: true, holders: [] });
    const events = desiredEvents(closure);
    expect(events).toHaveLength(1);
    expect(events[0].key).toBe(closure.shiftId);
    expect(events[0].event).toMatchObject({ isAllDay: true, showAs: "busy", attendees: [], subject: "HeimkinoWelt geschlossen (Inventur)" });

    for (const memberId of team.memberIds) {
      const { duties } = await loadPersonalDuties(memberId, now);
      expect(duties.some((d) => d.date === "2026-11-14")).toBe(false);
    }
  });
});
