import { describe, expect, it } from "vitest";
import { desiredEvent, dutyStartsAt, fingerprint, GRAPH_TIME_ZONE, type DutyForSync } from "@/lib/outlook/desired";
import { addDays } from "@/lib/rotation/dates";

const duty = (overrides: Partial<DutyForSync> = {}): DutyForSync => ({
  shiftId: "s1",
  rotationId: "r1",
  date: "2026-11-07",
  startTime: "09:30",
  endTime: "15:00",
  isAllDay: false,
  title: "Samstagsdienst",
  holders: [
    { email: "B@Firma.at", name: "Berta" },
    { email: "a@firma.at", name: "Anna" },
  ],
  ...overrides,
});

describe("desiredEvent", () => {
  it("builds a wall-clock event in the Vienna zone with sorted, lower-cased attendees", () => {
    expect(desiredEvent(duty())).toEqual({
      subject: "Samstagsdienst",
      start: { dateTime: "2026-11-07T09:30:00", timeZone: GRAPH_TIME_ZONE },
      end: { dateTime: "2026-11-07T15:00:00", timeZone: GRAPH_TIME_ZONE },
      isAllDay: false,
      attendees: [
        { address: "a@firma.at", name: "Anna" },
        { address: "b@firma.at", name: "Berta" },
      ],
    });
  });

  it("ends on the next day when the duty runs past midnight", () => {
    const event = desiredEvent(duty({ startTime: "22:00", endTime: "06:00" }));
    expect(event.end.dateTime).toBe("2026-11-08T06:00:00");
  });

  it("treats an end equal to the start as a 24-hour duty like the swap rules", () => {
    const base = duty();
    const event = desiredEvent({ ...base, startTime: "08:00", endTime: "08:00" });
    expect(event.start.dateTime).toBe(`${base.date}T08:00:00`);
    expect(event.end.dateTime).toBe(`${addDays(base.date, 1)}T08:00:00`);
  });

  it("spans whole days for all-day duties", () => {
    const event = desiredEvent(duty({ isAllDay: true, startTime: "00:00", endTime: "23:59" }));
    expect(event).toMatchObject({
      isAllDay: true,
      start: { dateTime: "2026-11-07T00:00:00" },
      end: { dateTime: "2026-11-08T00:00:00" },
    });
  });

  it("drops holders without an address and duplicates", () => {
    const event = desiredEvent(
      duty({ holders: [{ email: null, name: "X" }, { email: "a@firma.at", name: "A" }, { email: " A@firma.at ", name: "A2" }] })
    );
    expect(event.attendees).toEqual([{ address: "a@firma.at", name: "A" }]);
  });
});

describe("fingerprint", () => {
  it("changes with a holder change but not with holder order or names", () => {
    const base = fingerprint(desiredEvent(duty()));
    const reordered = fingerprint(desiredEvent(duty({ holders: [...duty().holders].reverse() })));
    const renamed = fingerprint(
      desiredEvent(duty({ holders: [{ email: "a@firma.at", name: "Anni" }, { email: "b@firma.at", name: null }] }))
    );
    const swapped = fingerprint(
      desiredEvent(duty({ holders: [{ email: "a@firma.at", name: "Anna" }, { email: "c@firma.at", name: "Cäsar" }] }))
    );
    expect(reordered).toBe(base);
    expect(renamed).toBe(base);
    expect(swapped).not.toBe(base);
  });

  it("changes with time and title", () => {
    const base = fingerprint(desiredEvent(duty()));
    expect(fingerprint(desiredEvent(duty({ endTime: "16:00" })))).not.toBe(base);
    expect(fingerprint(desiredEvent(duty({ title: "Andere" })))).not.toBe(base);
  });
});

describe("dutyStartsAt", () => {
  it("keeps the wall-clock time across the DST switch", () => {
    expect(dutyStartsAt("2026-03-29", "09:30").getHours()).toBe(9); // spring forward
    expect(dutyStartsAt("2026-10-25", "09:30").getHours()).toBe(9); // fall back
    expect(dutyStartsAt("2026-11-07", "09:30")).toEqual(new Date(2026, 10, 7, 9, 30));
  });
});
