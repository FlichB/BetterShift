import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { notificationOutbox, notificationPreferences } from "@/lib/notify/schema";
import { outlookEvents } from "@/lib/outlook/schema";
import { createRotation } from "@/lib/rotation/service";
import { createOffer } from "@/lib/swap/service";
import { shiftSwaps } from "@/lib/swap/schema";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { createUser, seedTeam } from "@/tests/helpers/seed";

describe("phase 3 schema", () => {
  it("defaults outlookEnabled to false", () => {
    const team = seedTeam({ members: 2 });
    const rotation = createRotation(
      {
        name: "R",
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
        entryTitle: "{Vorname} Dienst",
        dayOffEnabled: false,
        dayOffTitle: "{Vorname} dienstfrei",
        dayOffTiming: "after",
        dayOffExcludedIds: [],
        yearlyFairness: false,
        minPresent: null,
        reinforcedDates: [],
        holidayCalendarId: null,
        holidayOpenDates: [],
      },
      team.ownerId
    );
    expect(rotation.outlookEnabled).toBe(false);
  });

  it("keeps outlook_events rows without a shift (no foreign key)", () => {
    const shiftId = crypto.randomUUID();
    db.insert(outlookEvents).values({ eventKey: shiftId, shiftId, rotationId: "gone", startsAt: now }).run();
    expect(db.select().from(outlookEvents).where(eq(outlookEvents.eventKey, shiftId)).get()).toMatchObject({
      state: "active",
      attempts: 0,
      eventId: null,
    });
  });

  it("keys events by Platz and keeps old rows as per-duty keys", () => {
    db.insert(outlookEvents).values({ eventKey: "s-x:u-1", shiftId: "s-x", userId: "u-1", rotationId: "r-x", state: "active", startsAt: new Date() }).run();
    db.insert(outlookEvents).values({ eventKey: "s-x:u-2", shiftId: "s-x", userId: "u-2", rotationId: "r-x", state: "active", startsAt: new Date() }).run();
    expect(db.select().from(outlookEvents).where(eq(outlookEvents.shiftId, "s-x")).all()).toHaveLength(2);
  });

  it("cascades outbox rows with their swap and defaults preferences to on", async () => {
    const s = await seedDuties();
    const swap = createOffer(
      { shiftId: s.duty("2026-11-07"), type: "exchange", targetUserId: null, requestedShiftId: null, note: null },
      s.m0,
      now
    );
    db.insert(notificationOutbox).values({ kind: "offer_to_all", swapId: swap.id, actorUserId: s.m0 }).run();
    db.delete(shiftSwaps).where(eq(shiftSwaps.id, swap.id)).run();
    expect(db.select().from(notificationOutbox).where(eq(notificationOutbox.swapId, swap.id)).all()).toHaveLength(0);

    const userId = createUser("Pref");
    db.insert(notificationPreferences).values({ userId }).run();
    expect(db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).get()).toEqual({
      userId,
      offersToAll: true,
      offersToMe: true,
      myOffers: true,
      myDayOffs: true,
      dayOffRequests: true,
      myVacations: true,
      vacationRequests: true,
    });
  });
});
