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
  syncOutlook(graph, at, { bodyHtml: "<p>b</p>", cancelComment: "entfällt", rotationId: s.rotation.id, limit });
const row = (shiftId: string) => db.select().from(outlookEvents).where(eq(outlookEvents.shiftId, shiftId)).get();
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

  it("creates one event per future duty with the holders as attendees, then stays quiet", async () => {
    const result = await run();
    expect(result).toMatchObject({ created: 8, updated: 0, cancelled: 0, failures: [], authError: null, remaining: 0 });
    const first = row(s.duty("2026-11-07"))!;
    expect(first).toMatchObject({ state: "active", attempts: 0, lastError: null, transactionId: null, icalUid: `uid-${first.eventId}` });
    expect(graph.attendeesOf(first.eventId!)).toEqual([emailOf(s.m0), emailOf(s.m1)].sort());

    graph.calls = [];
    expect(await run()).toMatchObject({ created: 0, updated: 0, cancelled: 0 });
    expect(graph.calls).toEqual([]);
  });

  it("follows a holder change made outside fork code", async () => {
    await run();
    const shiftId = s.duty("2026-11-07");
    db.update(shiftSignups)
      .set({ userId: s.m4 })
      .where(and(eq(shiftSignups.shiftId, shiftId), eq(shiftSignups.userId, s.m1)))
      .run();
    graph.calls = [];
    expect(await run()).toMatchObject({ updated: 1 });
    const eventId = row(shiftId)!.eventId!;
    expect(graph.calls).toEqual([`update:${eventId}`]);
    expect(graph.attendeesOf(eventId)).toEqual([emailOf(s.m0), emailOf(s.m4)].sort());
  });

  it("cancels future events when the switch goes off and starts fresh when it comes back", async () => {
    await run();
    const shiftId = s.duty("2026-11-07");
    const oldEventId = row(shiftId)!.eventId!;
    enable(false);
    expect(await run()).toMatchObject({ cancelled: 8 });
    expect(row(shiftId)!.state).toBe("cancelled");
    expect(graph.events.get(oldEventId)!.isCancelled).toBe(true);

    enable(true);
    expect(await run()).toMatchObject({ created: 8 });
    expect(row(shiftId)).toMatchObject({ state: "active" });
    expect(row(shiftId)!.eventId).not.toBe(oldEventId);
  });

  it("cancels the event of a deleted duty and never touches begun duties", async () => {
    await run();
    const begunId = row(s.duty("2026-11-07"))!.eventId!;
    const deletedShift = s.duty("2026-11-14");
    const deletedId = row(deletedShift)!.eventId!;
    db.delete(shifts).where(eq(shifts.id, deletedShift)).run();
    const afterFirstDuty = new Date(2026, 10, 7, 10, 0); // Nov 7 duty has begun
    enable(false);
    const result = await run(afterFirstDuty);
    expect(result.cancelled).toBe(7); // all but Nov 7
    expect(graph.events.get(deletedId)!.isCancelled).toBe(true);
    expect(graph.calls).not.toContain(`cancel:${begunId}`);
    expect(row(s.duty("2026-11-07"))!.state).toBe("active");
  });

  it("re-creates an event deleted in office@ with a new transaction id", async () => {
    await run();
    const shiftId = s.duty("2026-11-07");
    const eventId = row(shiftId)!.eventId!;
    graph.events.delete(eventId);
    db.update(shiftSignups).set({ userId: s.m4 }).where(and(eq(shiftSignups.shiftId, shiftId), eq(shiftSignups.userId, s.m1))).run();
    const usedIds = [...graph.transactionIds];
    expect(await run()).toMatchObject({ updated: 0, created: 1 });
    expect(row(shiftId)!.eventId).not.toBe(eventId);
    expect(usedIds).not.toContain(graph.transactionIds.at(-1));
  });

  it("treats a cancel of an already deleted event as done", async () => {
    await run();
    graph.events.clear();
    enable(false);
    expect(await run()).toMatchObject({ cancelled: 8, failures: [] });
  });

  it("reuses the transaction id after a failed create", async () => {
    graph.failures.push(new Error("network down"));
    const result = await run(now, 1);
    expect(result.failures).toHaveLength(1);
    const shiftId = s.duty("2026-11-07");
    const pending = row(shiftId)!;
    expect(pending).toMatchObject({ eventId: null, attempts: 1, lastError: "network down" });
    expect(pending.nextAttemptAt).toEqual(minutes(1));

    expect(await run(minutes(2), 1)).toMatchObject({ created: 1 });
    expect(graph.transactionIds[0]).toBe(graph.transactionIds[1]);
  });

  it("waits for Retry-After and reports a failing duty only once", async () => {
    graph.failures.push(new GraphError(429, "429 TooManyRequests", 120_000));
    const first = await run(now, 1);
    expect(first.failures).toHaveLength(1);
    expect(row(s.duty("2026-11-07"))!.nextAttemptAt).toEqual(minutes(2));

    graph.calls = [];
    await run(minutes(1), 1); // Nov 7 still waits, so the next due duty is taken
    expect(graph.calls[0]).not.toBe("create:2026-11-07T09:30:00");

    graph.failures.push(new GraphError(500, "500 boom"));
    const again = await run(minutes(3), 1);
    expect(again.failures).toHaveLength(0); // second failure of the same duty
    expect(row(s.duty("2026-11-07"))!.attempts).toBe(2);
  });

  it("stops at an auth error without marking anything as failed", async () => {
    graph.failures.push(new GraphError(401, "401 InvalidAuthenticationToken"));
    const result = await run();
    expect(result).toMatchObject({ created: 0, authError: "401 InvalidAuthenticationToken", failures: [] });
    expect(graph.calls).toHaveLength(1);
    expect(row(s.duty("2026-11-07"))).toMatchObject({ attempts: 0, lastError: null });
  });

  it("limits the calls per run and reports what is left", async () => {
    expect(await run(now, 3)).toMatchObject({ created: 3, remaining: 5 });
  });

  it("resetBackoff makes waiting duties due again", async () => {
    graph.failures.push(new Error("x"));
    await run(now, 1);
    resetBackoff(s.rotation.id);
    expect(row(s.duty("2026-11-07"))!.nextAttemptAt).toBeNull();
  });
});

describe("backoffMs", () => {
  it("steps 1, 5, 15, 60 minutes and stays at an hour", () => {
    expect([1, 2, 3, 4, 9].map((n) => backoffMs(n) / 60_000)).toEqual([1, 5, 15, 60, 60]);
  });
});
