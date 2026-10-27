import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { buildIcsCalendar } from "@/lib/ics";
import { seedDuties } from "@/lib/swap/__tests__/fixtures";

const events = (ics: string) => new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents("vevent");

describe("buildIcsCalendar with only", () => {
  it("lists only the given shifts with suffixed UIDs, extra lines and its own name", async () => {
    const s = await seedDuties();
    const calendar = { id: s.team.calendarId, name: "Team", splitShiftsEnabled: false };
    const nov7 = s.duty("2026-11-07");
    const ics = await buildIcsCalendar({
      calendars: [calendar],
      locale: "de",
      feed: true,
      only: { shiftIds: [nov7], extraLines: new Map([[nov7, ["Mit: M2", "Tauschen: x"]]]), uidSuffix: "-me", calendarName: "Meine Dienste", titles: new Map() },
    });
    const list = events(ics);
    expect(list).toHaveLength(1);
    expect(list[0].getFirstPropertyValue("uid")).toBe(`${nov7}-me`);
    expect(list[0].getFirstPropertyValue("summary")).toBe("Samstagsdienst");
    expect(String(list[0].getFirstPropertyValue("description"))).toContain("Mit: M2\nTauschen: x");
    expect(new ICAL.Component(ICAL.parse(ics)).getFirstPropertyValue("x-wr-calname")).toBe("Meine Dienste");
  });

  it("returns an empty calendar for no shifts and keeps the team feed unchanged", async () => {
    const s = await seedDuties();
    const calendar = { id: s.team.calendarId, name: "Team", splitShiftsEnabled: false };
    const empty = await buildIcsCalendar({
      calendars: [],
      locale: "de",
      only: { shiftIds: [], extraLines: new Map(), uidSuffix: "-me", calendarName: "Meine Dienste", titles: new Map() },
    });
    expect(events(empty)).toHaveLength(0);

    const team = await buildIcsCalendar({ calendars: [calendar], locale: "de", feed: true });
    const list = events(team);
    expect(list).toHaveLength(8);
    expect(list.every((e) => !String(e.getFirstPropertyValue("uid")).endsWith("-me"))).toBe(true);
  });
});
