import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { shiftSignups, shifts, user } from "@/lib/db/schema";
import { GraphError } from "@/lib/outlook/graph-client";
import { outlookEvents } from "@/lib/outlook/schema";
import { backoffMs, resetBackoff, syncOutlook } from "@/lib/outlook/sync";
import { rotations } from "@/lib/rotation/schema";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { FakeGraph } from "@/tests/helpers/fake-graph";

let s: Awaited<ReturnType<typeof seedDuties>>;
let graph: FakeGraph;

// Tests in one file share a database, so every run is scoped to this test's rotation.
const run = (at: Date = now, limit?: number) =>
  syncOutlook(graph, at, { renderBody: () => "<p>b</p>", cancelComment: "entfällt", rotationId: s.rotation.id, limit });
const row = (shiftId: string, userId: string | null = null) =>
  db.select().from(outlookEvents).where(eq(outlookEvents.eventKey, userId ? `${shiftId}:${userId}` : shiftId)).get();
const placeRows = (shiftId: string) => db.select().from(outlookEvents).where(eq(outlookEvents.shiftId, shiftId)).all();
// The event of the first Platz of a duty.
const firstPlace = (shiftId: string) => row(shiftId, s.holders(shiftId)[0])!;
const emailOf = (id: string) => db.select({ email: user.email }).from(user).where(eq(user.id, id)).get()!.email;
const enable = (on: boolean) => db.update(rotations).set({ outlookEnabled: on }).where(eq(rotations.id, s.rotation.id)).run();
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

beforeEach(async () => {
  s = await seedDuties(); // 8 Saturday duties, Nov 7 … Dec 26
  graph = new FakeGraph();
  enable(true);
});

describe("syncOutlook", () => {
  it("does nothing for rotations without the switch", async () => {
    enable(false);
    expect(await run()).toMatchObject({ created: 0, updated: 0, cancelled: 0 });
    expect(graph.calls).toEqual([]);
  });

  it("creates one all-day free event per Platz with only its holder", async () => {
    const result = await run();
    expect(result).toMatchObject({ created: 16, updated: 0, cancelled: 0, failures: [] }); // 8 duties × 2 Plätze
    const shiftId = s.duty("2026-11-07");
    const [h0, h1] = s.holders(shiftId);
    for (const userId of [h0, h1]) {
      const place = row(shiftId, userId)!;
      expect(place).toMatchObject({ state: "active", attempts: 0, lastError: null, transactionId: null, userId, icalUid: `uid-${place.eventId}` });
      expect(graph.attendeesOf(place.eventId!)).toEqual([emailOf(userId)]);
      expect(graph.events.get(place.eventId!)).toMatchObject({ isAllDay: true });
    }

    graph.calls = [];
    expect(await run()).toMatchObject({ created: 0, updated: 0, cancelled: 0 });
    expect(graph.calls).toEqual([]);
  });

  it("a holder change cancels the old Platz event and invites the new holder, nothing else", async () => {
    await run();
    const shiftId = s.duty("2026-11-07");
    const [, h1] = s.holders(shiftId);
    const oldEvent = row(shiftId, h1)!.eventId!;
    db.update(shiftSignups).set({ userId: s.m4 }).where(and(eq(shiftSignups.shiftId, shiftId), eq(shiftSignups.userId, h1))).run();
    graph.calls = [];
    expect(await run()).toMatchObject({ created: 1, updated: 1, cancelled: 1 }); // the partner's event lists the new partner
    expect(graph.calls).toContain(`cancel:${oldEvent}`);
    expect(graph.attendeesOf(row(shiftId, s.m4)!.eventId!)).toEqual([emailOf(s.m4)]);
  });

  it("a new Eintragsvorlage only updates", async () => {
    await run();
    db.update(rotations).set({ entryTitle: "{Name} hat Dienst" }).where(eq(rotations.id, s.rotation.id)).run();
    graph.calls = [];
    expect(await run()).toMatchObject({ created: 0, updated: 16, cancelled: 0 });
  });

  it("cancels a per-duty event left over from before the switch to Plätze", async () => {
    const shiftId = s.duty("2026-11-14");
    db.insert(outlookEvents)
      .values({ eventKey: shiftId, shiftId, userId: null, rotationId: s.rotation.id, eventId: "legacy-1", state: "active", startsAt: new Date(2026, 10, 14, 9, 30) })
      .run();
    graph.events.set("legacy-1", { id: "legacy-1", subject: "Samstagsdienst", start: { dateTime: "2026-11-14T09:30:00", timeZone: "x" }, end: { dateTime: "2026-11-14T15:00:00", timeZone: "x" }, isAllDay: false, isCancelled: false, attendees: [] });
    await run();
    expect(graph.calls).toContain("cancel:legacy-1");
    expect(db.select().from(outlookEvents).where(eq(outlookEvents.eventKey, shiftId)).get()?.state).toBe("cancelled");
  });

  it("cancels future events when the switch goes off and starts fresh when it comes back", async () => {
    await run();
    const shiftId = s.duty("2026-11-07");
    const oldEventId = firstPlace(shiftId).eventId!;
    enable(false);
    expect(await run()).toMatchObject({ cancelled: 16 }); // 8 duties × 2 Plätze
    expect(firstPlace(shiftId).state).toBe("cancelled");
    expect(graph.events.get(oldEventId)!.isCancelled).toBe(true);

    enable(true);
    expect(await run()).toMatchObject({ created: 16 });
    expect(firstPlace(shiftId)).toMatchObject({ state: "active" });
    expect(firstPlace(shiftId).eventId).not.toBe(oldEventId);
  });

  it("cancels the event of a deleted duty and never touches begun duties", async () => {
    await run();
    const begunId = firstPlace(s.duty("2026-11-07")).eventId!;
    const deletedShift = s.duty("2026-11-14");
    const deletedIds = placeRows(deletedShift).map((r) => r.eventId!); // both Plätze
    db.delete(shifts).where(eq(shifts.id, deletedShift)).run();
    const afterFirstDuty = new Date(2026, 10, 7, 10, 0); // Nov 7 duty has begun
    enable(false);
    const result = await run(afterFirstDuty);
    expect(result.cancelled).toBe(14); // all but Nov 7: 7 duties × 2 Plätze
    expect(deletedIds).toHaveLength(2);
    for (const id of deletedIds) expect(graph.events.get(id)!.isCancelled).toBe(true);
    expect(graph.calls).not.toContain(`cancel:${begunId}`);
    expect(firstPlace(s.duty("2026-11-07")).state).toBe("active");
  });

  it("re-creates an event deleted in office@ with a new transaction id", async () => {
    await run();
    const shiftId = s.duty("2026-11-07");
    const [h0, h1] = s.holders(shiftId);
    const eventId = row(shiftId, h0)!.eventId!;
    graph.events.delete(eventId);
    db.update(shiftSignups).set({ userId: s.m4 }).where(and(eq(shiftSignups.shiftId, shiftId), eq(shiftSignups.userId, h1))).run();
    const usedIds = [...graph.transactionIds];
    // h0's event is gone (re-created instead of updated), h1's is cancelled, m4 is new
    expect(await run()).toMatchObject({ updated: 0, created: 2, cancelled: 1 });
    expect(row(shiftId, h0)!.eventId).not.toBe(eventId);
    expect(usedIds).not.toContain(graph.transactionIds.at(-1));
  });

  it("treats a cancel of an already deleted event as done", async () => {
    await run();
    graph.events.clear();
    enable(false);
    expect(await run()).toMatchObject({ cancelled: 16, failures: [] });
  });

  it("reuses the transaction id after a failed create", async () => {
    graph.failures.push(new Error("network down"));
    const result = await run(now, 1);
    expect(result.failures).toHaveLength(1);
    const shiftId = s.duty("2026-11-07");
    const pending = placeRows(shiftId).find((r) => r.attempts > 0)!;
    expect(pending).toMatchObject({ eventId: null, attempts: 1, lastError: "network down" });
    expect(pending.nextAttemptAt).toEqual(minutes(1));

    expect(await run(minutes(2), 1)).toMatchObject({ created: 1 });
    expect(graph.transactionIds[0]).toBe(graph.transactionIds[1]);
  });

  it("waits for Retry-After and reports a failing duty only once", async () => {
    graph.failures.push(new GraphError(429, "429 TooManyRequests", 120_000));
    const first = await run(now, 1);
    expect(first.failures).toHaveLength(1);
    const shiftId = s.duty("2026-11-07");
    const failed = placeRows(shiftId).find((r) => r.attempts > 0)!;
    expect(failed.nextAttemptAt).toEqual(minutes(2));

    await run(minutes(1), 1); // that Platz still waits, so the next due one is taken
    expect(row(shiftId, failed.userId)).toMatchObject({ eventId: null, attempts: 1 });
    expect(placeRows(shiftId).filter((r) => r.eventId)).toHaveLength(1);

    graph.failures.push(new GraphError(500, "500 boom"));
    const again = await run(minutes(3), 1);
    expect(again.failures).toHaveLength(0); // second failure of the same Platz
    expect(row(shiftId, failed.userId)!.attempts).toBe(2);
  });

  it("stops at an auth error without marking anything as failed", async () => {
    graph.failures.push(new GraphError(401, "401 InvalidAuthenticationToken"));
    const result = await run();
    expect(result).toMatchObject({ created: 0, authError: "401 InvalidAuthenticationToken", failures: [] });
    expect(graph.calls).toHaveLength(1);
    expect(placeRows(s.duty("2026-11-07")).every((r) => r.attempts === 0 && r.lastError === null)).toBe(true);
  });

  it("limits the calls per run and reports what is left", async () => {
    expect(await run(now, 3)).toMatchObject({ created: 3, remaining: 13 });
  });

  it("resetBackoff makes waiting duties due again", async () => {
    graph.failures.push(new Error("x"));
    await run(now, 1);
    const failed = placeRows(s.duty("2026-11-07")).find((r) => r.attempts > 0)!;
    expect(failed.nextAttemptAt).not.toBeNull();
    resetBackoff(s.rotation.id);
    expect(row(failed.shiftId, failed.userId)!.nextAttemptAt).toBeNull();
  });
});

describe("syncOutlook edge cases", () => {
  it("cancels an event whose create response was lost", async () => {
    graph.loseNextCreateResponse = true;
    expect((await run(now, 1)).failures).toHaveLength(1);
    const shiftId = s.duty("2026-11-07");
    const lost = placeRows(shiftId).find((r) => r.attempts > 0)!;
    expect(lost).toMatchObject({ eventId: null });
    expect(graph.events.size).toBe(1);
    const [storedId] = [...graph.events.keys()];

    enable(false);
    expect(await run(minutes(2))).toMatchObject({ cancelled: 1 });
    expect(graph.events.get(storedId)!.isCancelled).toBe(true);
    expect(row(shiftId, lost.userId)!.state).toBe("cancelled");
  });

  it("deletes the event when Graph refuses to cancel one without attendees", async () => {
    await run();
    enable(false);
    graph.calls = [];
    graph.failures.push(new GraphError(400, "400 ErrorInvalidRequest"));
    expect(await run(now, 1)).toMatchObject({ cancelled: 1, failures: [] });
    const eventId = graph.calls[0].slice("cancel:".length);
    expect(graph.calls).toEqual([`cancel:${eventId}`, `delete:${eventId}`]);
    expect(graph.events.has(eventId)).toBe(false);
    expect(db.select().from(outlookEvents).where(and(eq(outlookEvents.rotationId, s.rotation.id), eq(outlookEvents.eventId, eventId))).get()!.state).toBe("cancelled");
  });

  it("patches the event on the next run when a reused transaction id may have returned old content", async () => {
    graph.failures.push(new Error("network down"));
    await run(now, 1);
    const shiftId = s.duty("2026-11-07");
    const failed = placeRows(shiftId).find((r) => r.attempts > 0)!;
    const other = s.holders(shiftId).find((id) => id !== failed.userId)!;
    // The partner changes, so the content of the failed Platz changes while its transaction id is reused.
    db.update(shiftSignups).set({ userId: s.m4 }).where(and(eq(shiftSignups.shiftId, shiftId), eq(shiftSignups.userId, other))).run();
    // Every Platz is still missing (16 events); X reuses its old transaction id.
    expect(await run(minutes(2))).toMatchObject({ created: 16, cancelled: 0 });
    expect(row(shiftId, failed.userId)!.fingerprint).toBeNull();

    graph.calls = [];
    expect(await run(minutes(3))).toMatchObject({ created: 0, updated: 1, cancelled: 0 });
    expect(graph.calls).toEqual([`update:${row(shiftId, failed.userId)!.eventId}`]);
    expect(row(shiftId, failed.userId)!.fingerprint).not.toBeNull();
  });
});

describe("backoffMs", () => {
  it("steps 1, 5, 15, 60 minutes and stays at an hour", () => {
    expect([1, 2, 3, 4, 9].map((n) => backoffMs(n) / 60_000)).toEqual([1, 5, 15, 60, 60]);
  });
});
