import { describe, expect, it } from "vitest";
import { desiredEvents, dutyStartsAt, fingerprint, placeKey, type DutyForSync } from "@/lib/outlook/desired";

const duty = (patch: Partial<DutyForSync> = {}): DutyForSync => ({
  shiftId: "s1",
  rotationId: "r1",
  kind: "duty",
  date: "2026-11-07",
  startTime: "09:30",
  endTime: "15:00",
  isAllDay: false,
  title: "Samstagsdienst",
  entryTitle: "{Vorname} Dienst",
  holders: [
    { userId: "u1", email: "G.Maier@example.at", name: "Günther Maier" },
    { userId: "u2", email: "anna@example.at", name: "Anna Berger" },
  ],
  ...patch,
});

describe("desiredEvents", () => {
  it("one all-day free event per holder, only that holder invited", () => {
    const events = desiredEvents(duty());
    expect(events.map((e) => e.key)).toEqual(["s1:u1", "s1:u2"]);
    expect(events[0]).toMatchObject({ shiftId: "s1", userId: "u1", rotationId: "r1", date: "2026-11-07", startTime: "09:30" });
    expect(events[0].event).toEqual({
      subject: "Günther Dienst",
      start: { dateTime: "2026-11-07T00:00:00", timeZone: "W. Europe Standard Time" },
      end: { dateTime: "2026-11-08T00:00:00", timeZone: "W. Europe Standard Time" },
      isAllDay: true,
      showAs: "free",
      attendees: [{ address: "g.maier@example.at", name: "Günther Maier" }],
      details: { time: "09:30–15:00", partners: ["Anna Berger"] },
    });
  });

  it("skips holders without e-mail and duplicate addresses", () => {
    const events = desiredEvents(
      duty({
        holders: [
          { userId: "u1", email: null, name: "Ohne Mail" },
          { userId: "u2", email: "a@example.at", name: "A" },
          { userId: "u3", email: "A@example.at", name: "A2" },
        ],
      })
    );
    expect(events.map((e) => e.key)).toEqual(["s1:u2"]);
    expect(events[0].event.details.partners).toEqual(["A2", "Ohne Mail"]);
  });

  it("an all-day duty has no time line; a duty past midnight stays on its start day", () => {
    expect(desiredEvents(duty({ isAllDay: true }))[0].event.details.time).toBeNull();
    const night = desiredEvents(duty({ startTime: "22:00", endTime: "06:00" }))[0].event;
    expect([night.start.dateTime, night.end.dateTime]).toEqual(["2026-11-07T00:00:00", "2026-11-08T00:00:00"]);
    expect(night.details.time).toBe("22:00–06:00");
  });

  it("a Schließeintrag stays one busy event without attendees, keyed by the shift", () => {
    const [closure] = desiredEvents(duty({ kind: "closed", isAllDay: true, title: "Geschlossen (Inventur)", holders: [] }));
    expect(closure.key).toBe(placeKey("s1", null));
    expect(closure.key).toBe("s1");
    expect(closure.event).toMatchObject({ subject: "Geschlossen (Inventur)", isAllDay: true, showAs: "busy", attendees: [] });
  });

  it("fingerprint follows subject, partners and time, not the holder's display name", () => {
    const base = fingerprint(desiredEvents(duty())[0].event);
    expect(fingerprint(desiredEvents(duty({ entryTitle: "{Name}" }))[0].event)).not.toBe(base);
    expect(fingerprint(desiredEvents(duty({ endTime: "16:00" }))[0].event)).not.toBe(base);
    const renamedPartner = duty();
    renamedPartner.holders[1] = { ...renamedPartner.holders[1], name: "Anna Huber" };
    expect(fingerprint(desiredEvents(renamedPartner)[0].event)).not.toBe(base);
  });
});

describe("dutyStartsAt", () => {
  it("keeps the wall-clock time across the DST switch", () => {
    expect(dutyStartsAt("2026-03-29", "09:30").getHours()).toBe(9); // spring forward
    expect(dutyStartsAt("2026-10-25", "09:30").getHours()).toBe(9); // fall back
    expect(dutyStartsAt("2026-11-07", "09:30")).toEqual(new Date(2026, 10, 7, 9, 30));
  });
});
