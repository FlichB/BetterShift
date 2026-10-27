import ICAL from "ical.js";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { calendarShares, user } from "@/lib/db/schema";
import { buildPersonalFeed, isUserBanned, loadPersonalDuties } from "@/lib/feed/personal";
import { acceptOffer, createOffer } from "@/lib/swap/service";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";

let s: Awaited<ReturnType<typeof seedDuties>>;
beforeEach(async () => {
  s = await seedDuties(); // m0 holds 11-07 and 12-12, m2 holds 11-14 and 12-05, …
});

const dates = async (userId: string, at: Date = now) =>
  (await loadPersonalDuties(userId, at)).duties.map((d) => d.date).sort();

describe("loadPersonalDuties", () => {
  it("lists only the user's own Plätze with the partners' names", async () => {
    expect(await dates(s.m0)).toEqual(["2026-11-07", "2026-12-12"]);
    const { duties, calendars } = await loadPersonalDuties(s.m0, now);
    expect(duties[0].partners).toEqual(["M2"]);
    expect(calendars).toEqual([{ id: s.team.calendarId, name: "Team", splitShiftsEnabled: false }]);
  });

  it("follows a swap", async () => {
    const offer = createOffer(
      { shiftId: s.duty("2026-11-07"), type: "give", targetUserId: null, requestedShiftId: null, note: null },
      s.m0,
      now
    );
    acceptOffer(offer.id, s.m2, null, now);
    expect(await dates(s.m0)).toEqual(["2026-12-12"]);
    expect(await dates(s.m2)).toEqual(["2026-11-07", "2026-11-14", "2026-12-05"]);
  });

  it("drops calendars the user can no longer read", async () => {
    db.delete(calendarShares)
      .where(and(eq(calendarShares.calendarId, s.team.calendarId), eq(calendarShares.userId, s.m0)))
      .run();
    expect(await dates(s.m0)).toEqual([]);
  });

  it("keeps the last 60 days and drops older duties", async () => {
    const inFeb = new Date(2027, 1, 1, 12, 0); // 60 days back = 2026-12-03
    expect(await dates(s.m0, inFeb)).toEqual(["2026-12-12"]);
  });
});

describe("isUserBanned", () => {
  it("honours ban expiry like better-auth", () => {
    expect(isUserBanned(s.m0, now)).toBe(false);
    db.update(user).set({ banned: true, banExpires: null }).where(eq(user.id, s.m0)).run();
    expect(isUserBanned(s.m0, now)).toBe(true);
    db.update(user).set({ banExpires: new Date(now.getTime() - 1000) }).where(eq(user.id, s.m0)).run();
    expect(isUserBanned(s.m0, now)).toBe(false);
  });
});

describe("buildPersonalFeed", () => {
  it("renders the duties with partner line, swap link and the German calendar name", async () => {
    const cal = new ICAL.Component(ICAL.parse(await buildPersonalFeed(s.m0, now)));
    expect(cal.getFirstPropertyValue("x-wr-calname")).toBe("Meine Dienste");
    const events = cal.getAllSubcomponents("vevent");
    expect(events).toHaveLength(2);
    const description = String(events[0].getFirstPropertyValue("description"));
    expect(description).toContain("Mit: M2");
    expect(description).toMatch(/Tauschen: https?:\/\/.+\/swaps/);
    expect(String(events[0].getFirstPropertyValue("uid"))).toMatch(/-me$/);
  });
});
