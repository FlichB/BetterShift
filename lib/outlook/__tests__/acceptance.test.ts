// [fork] Acceptance criteria of SPEC §9 phase 3, proven against FakeGraph (real tenant: user's step).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { shiftSignups } from "@/lib/db/schema";
import { GraphError } from "@/lib/outlook/graph-client";
import { outlookEvents } from "@/lib/outlook/schema";
import { syncOutlook, verifyOutlook } from "@/lib/outlook/sync";
import { inputFromRotation } from "@/lib/rotation/input";
import { rotations } from "@/lib/rotation/schema";
import { getRotation, runGeneration, updateRotation } from "@/lib/rotation/service";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { FakeGraph } from "@/tests/helpers/fake-graph";

let s: Awaited<ReturnType<typeof seedDuties>>;
let graph: FakeGraph;
const run = (at: Date = now) =>
  syncOutlook(graph, at, { renderBody: () => "<p>b</p>", cancelComment: "entfällt", rotationId: s.rotation.id });
const row = (shiftId: string, userId: string | null = null) =>
  db.select().from(outlookEvents).where(eq(outlookEvents.eventKey, userId ? `${shiftId}:${userId}` : shiftId)).get();
const eventIdsOf = (shiftId: string) =>
  db.select().from(outlookEvents).where(eq(outlookEvents.shiftId, shiftId)).all().map((r) => r.eventId!);
const firstHolder = (date: string) => s.holders(s.duty(date))[0];

beforeEach(async () => {
  s = await seedDuties();
  graph = new FakeGraph();
  db.update(rotations).set({ outlookEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
  await run();
});

describe("Outlook acceptance", () => {
  it("an Ausfalltag cancels the future events of that day and never touches begun ones", async () => {
    const begun = row(s.duty("2026-11-07"), firstHolder("2026-11-07"))!.eventId!;
    const skipped = eventIdsOf(s.duty("2026-11-21")); // both Plätze of the day
    const later = new Date(2026, 10, 7, 10, 0); // 11-07 is running
    const r = getRotation(s.rotation.id)!;
    updateRotation(s.rotation.id, { ...inputFromRotation(r), skipDates: [{ date: "2026-11-21", reason: "Inventur" }] });
    await runGeneration(s.rotation.id, "2026-11-02", "2026-12-27", s.team.ownerId, later);
    graph.calls = [];
    await run(later);
    expect(skipped).toHaveLength(2);
    for (const id of skipped) expect(graph.events.get(id)!.isCancelled).toBe(true);
    // The skip also shifts the holders of the 5 later duties, so each of their 2 old Plätze is cancelled and replaced.
    const cancels = graph.calls.filter((c) => c.startsWith("cancel:"));
    expect(cancels).toHaveLength(2 + 5 * 2);
    for (const id of skipped) expect(cancels).toContain(`cancel:${id}`);
    expect(graph.calls.some((c) => c.endsWith(begun))).toBe(false);
    expect(graph.events.get(begun)!.isCancelled).toBe(false);
    expect(row(s.duty("2026-11-07"), firstHolder("2026-11-07"))!.state).toBe("active");
  });

  it("the nightly verify restores a deleted event and repairs an edited one", async () => {
    const deleted = row(s.duty("2026-11-14"), firstHolder("2026-11-14"))!.eventId!;
    const edited = row(s.duty("2026-11-21"), firstHolder("2026-11-21"))!.eventId!;
    graph.events.delete(deleted);
    const subject = graph.events.get(edited)!.subject;
    graph.events.set(edited, { ...graph.events.get(edited)!, subject: "Geändert" });
    expect((await verifyOutlook(graph, now, s.rotation.id)).drifted).toBe(2);
    await run();
    const restored = row(s.duty("2026-11-14"), firstHolder("2026-11-14"))!.eventId!;
    expect(restored).not.toBe(deleted);
    expect(graph.events.get(restored)!.isCancelled).toBe(false);
    expect(graph.events.get(edited)!.subject).toBe(subject);
  });

  it("a Graph outage loses no change", async () => {
    const shiftId = s.duty("2026-11-14");
    db.update(shiftSignups).set({ userId: s.m0 }).where(eq(shiftSignups.userId, s.m2)).run(); // m2 → m0 by hand
    graph.failures = Array.from({ length: 20 }, () => new GraphError(503, "503 Service Unavailable"));
    const during = await run();
    expect(during.updated).toBe(0);
    expect(row(shiftId, s.m0)!.attempts).toBeGreaterThan(0);

    graph.failures = [];
    const after = new Date(now.getTime() + 2 * 3_600_000); // past every backoff
    await run(after);
    const attendees = graph.events.get(row(shiftId, s.m0)!.eventId!)!.attendees.map((a) => a.address);
    expect(attendees).toHaveLength(1);
    expect(attendees[0].startsWith("m1-")).toBe(true); // s.m0 is user "M1"
    expect(row(shiftId, s.m0)!.attempts).toBe(0);
  });
});
