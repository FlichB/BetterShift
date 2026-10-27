// [fork] Dienstfreie as office@ events: out of office, all-day, only the holder invited.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dayOffs } from "@/lib/dayoff/schema";
import { lockDayOff, reconcileRotation } from "@/lib/dayoff/service";
import { dayOffKey, desiredDayOffEvent } from "@/lib/outlook/desired";
import { loadDesiredPlaces } from "@/lib/outlook/sync";
import { rotations } from "@/lib/rotation/schema";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";

describe("desiredDayOffEvent", () => {
  it("is an all-day out-of-office event with only the holder invited", () => {
    const holder = { userId: "u1", email: "a@x.at", name: "Anna Test" };
    const place = desiredDayOffEvent({ id: "d1", shiftId: "s1", rotationId: "r1", userId: "u1", date: "2026-11-09", title: "Anna dienstfrei", holder });
    expect(place.key).toBe("dayoff:d1:u1");
    expect(place.key).toBe(dayOffKey("d1", "u1"));
    expect(place.startTime).toBe("00:00");
    expect(place.event).toMatchObject({
      subject: "Anna dienstfrei",
      isAllDay: true,
      showAs: "oof",
      attendees: [{ address: "a@x.at", name: "Anna Test" }],
      details: { time: null, partners: [] },
    });
    expect(place.event.start.dateTime).toBe("2026-11-09T00:00:00");
    expect(place.event.end.dateTime).toBe("2026-11-10T00:00:00");
  });
});

describe("loadDesiredPlaces with Dienstfreie", () => {
  it("wants one event per dated Dienstfrei and drops a locked one", async () => {
    const s = await seedDuties();
    db.update(rotations).set({ outlookEnabled: true, dayOffEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
    db.transaction((tx) => reconcileRotation(tx, s.rotation.id, now));
    const keys = () => loadDesiredPlaces(now, s.rotation.id).map((p) => p.key).filter((k) => k.startsWith("dayoff:"));
    expect(keys()).toHaveLength(16);
    const row = db.select().from(dayOffs).all()[0];
    lockDayOff(row.id, null, s.team.ownerId, now);
    expect(keys()).toHaveLength(15);
    expect(keys()).not.toContain(dayOffKey(row.id, row.userId));
  });

  it("wants nothing while Dienstfrei is off", async () => {
    const s = await seedDuties();
    db.update(rotations).set({ outlookEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
    expect(loadDesiredPlaces(now, s.rotation.id).filter((p) => p.key.startsWith("dayoff:"))).toHaveLength(0);
  });
});
