// [fork] Urlaub in Outlook (SPEC 12.43 point 9).
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { desiredVacationEvent, dutyStartsAt, fingerprint } from "@/lib/outlook/desired";
import { loadDesiredPlaces } from "@/lib/outlook/sync";
import { rotations } from "@/lib/rotation/schema";
import { vacations } from "@/lib/vacation/schema";
import { vacationTitle } from "@/lib/vacation/title";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";

describe("vacation events", () => {
  it("is one all-day out-of-office event over the whole range", () => {
    const e = desiredVacationEvent({ id: "v1", rotationId: "r1", userId: "u1", startDate: "2026-12-07", endDate: "2026-12-11", title: "Mia Urlaub", holder: { userId: "u1", email: "Mia@x.at", name: "Mia" } });
    expect(e.key).toBe("vacation:v1");
    expect(e.event).toMatchObject({ isAllDay: true, showAs: "oof", subject: "Mia Urlaub" });
    expect(e.event.start.dateTime).toBe("2026-12-07T00:00:00");
    expect(e.event.end.dateTime).toBe("2026-12-12T00:00:00");
    expect(e.event.attendees).toEqual([{ address: "mia@x.at", name: "Mia" }]);
  });

  it("is desired for approved, not yet ended vacations of Outlook rotations only", async () => {
    const s = await seedDuties();
    db.update(rotations).set({ outlookEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
    db.insert(vacations).values([
      { userId: s.m1, startDate: "2026-12-01", endDate: "2026-12-03", status: "approved", requestedBy: s.m1 },
      { userId: s.m2, startDate: "2026-12-01", endDate: "2026-12-03", status: "pending", requestedBy: s.m2 },
      { userId: s.m3, startDate: "2026-10-12", endDate: "2026-10-21", status: "approved", requestedBy: s.m3 }, // ended yesterday
    ]).run();
    const keys = loadDesiredPlaces(now).filter((p) => p.key.startsWith("vacation:"));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ userId: s.m1, rotationId: s.rotation.id, date: "2026-12-03" }); // begun on its last day
  });

  it("keeps a running vacation desired so a new end reaches Outlook (final review I3)", async () => {
    const s = await seedDuties();
    db.update(rotations).set({ outlookEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
    // now is 2026-10-22: started yesterday, ends in three days.
    const [v] = db.insert(vacations).values({ userId: s.m1, startDate: "2026-10-21", endDate: "2026-10-25", status: "approved", requestedBy: s.m1 }).returning().all();
    const place = () => loadDesiredPlaces(now).find((p) => p.key === `vacation:${v.id}`);
    const before = place();
    expect(before).toBeDefined();
    expect(dutyStartsAt(before!.date, before!.startTime).getTime()).toBeGreaterThan(now.getTime()); // not begun for the sync
    db.update(vacations).set({ endDate: "2026-10-27" }).where(eq(vacations.id, v.id)).run();
    const after = place();
    expect(after!.event.end.dateTime).toBe("2026-10-28T00:00:00");
    expect(fingerprint(after!.event)).not.toBe(fingerprint(before!.event));
  });

  it("titles a vacation with the first name in the mail locale's wording", () => {
    expect(vacationTitle({ name: "Mia Muster", email: null })).toBe("Mia Urlaub");
    expect(vacationTitle({ name: "Mia Muster", email: null }, "en")).toBe("Mia vacation");
  });
});
