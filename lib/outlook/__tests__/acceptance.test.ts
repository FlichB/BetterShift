// [fork] Acceptance criteria of SPEC §9 phase 3, proven against FakeGraph (real tenant: user's step).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { shiftSignups } from "@/lib/db/schema";
import { GraphError } from "@/lib/outlook/graph-client";
import { outlookEvents } from "@/lib/outlook/schema";
import { syncOutlook, verifyOutlook } from "@/lib/outlook/sync";
import { rotations } from "@/lib/rotation/schema";
import { getRotation, runGeneration, updateRotation } from "@/lib/rotation/service";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { FakeGraph } from "@/tests/helpers/fake-graph";

let s: Awaited<ReturnType<typeof seedDuties>>;
let graph: FakeGraph;
const run = (at: Date = now) =>
  syncOutlook(graph, at, { bodyHtml: "<p>b</p>", cancelComment: "entfällt", rotationId: s.rotation.id });
const row = (shiftId: string) => db.select().from(outlookEvents).where(eq(outlookEvents.shiftId, shiftId)).get();

beforeEach(async () => {
  s = await seedDuties();
  graph = new FakeGraph();
  db.update(rotations).set({ outlookEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
  await run();
});

describe("Outlook acceptance", () => {
  it("an Ausfalltag cancels only that future event and never touches begun ones", async () => {
    const begun = row(s.duty("2026-11-07"))!.eventId!;
    const skipped = row(s.duty("2026-11-21"))!.eventId!;
    const later = new Date(2026, 10, 7, 10, 0); // 11-07 is running
    const r = getRotation(s.rotation.id)!;
    updateRotation(s.rotation.id, {
      name: r.name,
      calendarId: r.calendarId,
      presetId: r.presetId!,
      memberIds: r.memberIds,
      perShift: r.perShift,
      period: r.period,
      periodDays: r.periodDays,
      startDate: r.startDate,
      startOffset: r.startOffset,
      weekdays: r.weekdays,
      skipDates: ["2026-11-21"],
    });
    await runGeneration(s.rotation.id, "2026-11-02", "2026-12-27", s.team.ownerId, later);
    graph.calls = [];
    await run(later);
    expect(graph.events.get(skipped)!.isCancelled).toBe(true);
    expect(graph.calls.filter((c) => c.startsWith("cancel:"))).toEqual([`cancel:${skipped}`]);
    expect(graph.calls.some((c) => c.endsWith(begun))).toBe(false);
  });

  it("the nightly verify restores a deleted event and repairs an edited one", async () => {
    const deleted = row(s.duty("2026-11-14"))!.eventId!;
    const edited = row(s.duty("2026-11-21"))!.eventId!;
    graph.events.delete(deleted);
    graph.events.set(edited, { ...graph.events.get(edited)!, subject: "Geändert" });
    expect((await verifyOutlook(graph, now, s.rotation.id)).drifted).toBe(2);
    await run();
    const restored = row(s.duty("2026-11-14"))!.eventId!;
    expect(restored).not.toBe(deleted);
    expect(graph.events.get(restored)!.isCancelled).toBe(false);
    expect(graph.events.get(edited)!.subject).toBe("Samstagsdienst");
  });

  it("a Graph outage loses no change", async () => {
    const shiftId = s.duty("2026-11-14");
    db.update(shiftSignups).set({ userId: s.m0 }).where(eq(shiftSignups.userId, s.m2)).run(); // m2 → m0 by hand
    graph.failures = Array.from({ length: 20 }, () => new GraphError(503, "503 Service Unavailable"));
    const during = await run();
    expect(during.updated).toBe(0);
    expect(row(shiftId)!.attempts).toBeGreaterThan(0);

    graph.failures = [];
    const after = new Date(now.getTime() + 2 * 3_600_000); // past every backoff
    await run(after);
    const attendees = graph.events.get(row(shiftId)!.eventId!)!.attendees.map((a) => a.address);
    expect(attendees.some((a) => a.startsWith("m1-"))).toBe(true); // s.m0 is user "M1"
    expect(row(shiftId)!.attempts).toBe(0);
  });
});
