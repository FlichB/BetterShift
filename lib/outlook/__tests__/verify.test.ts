import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GraphError } from "@/lib/outlook/graph-client";
import { outlookEvents } from "@/lib/outlook/schema";
import { syncOutlook, verifyOutlook } from "@/lib/outlook/sync";
import { rotations } from "@/lib/rotation/schema";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { FakeGraph } from "@/tests/helpers/fake-graph";

let s: Awaited<ReturnType<typeof seedDuties>>;
let graph: FakeGraph;
const sync = () => syncOutlook(graph, now, { bodyHtml: "", cancelComment: "", rotationId: s.rotation.id });
const eventOf = (date: string) =>
  db.select().from(outlookEvents).where(eq(outlookEvents.shiftId, s.duty(date))).get()!.eventId!;

beforeEach(async () => {
  s = await seedDuties();
  graph = new FakeGraph();
  db.update(rotations).set({ outlookEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
  await sync();
  graph.calls = [];
});

describe("verifyOutlook", () => {
  it("reports no drift when office@ matches", async () => {
    expect(await verifyOutlook(graph, now, s.rotation.id)).toEqual({ drifted: 0, authError: null });
    expect(graph.calls.every((c) => c.startsWith("get:"))).toBe(true);
    expect(graph.calls).toHaveLength(8);
  });

  it("re-creates deleted or cancelled events and patches edited ones", async () => {
    graph.events.delete(eventOf("2026-11-07"));
    const cancelled = eventOf("2026-11-14");
    graph.events.set(cancelled, { ...graph.events.get(cancelled)!, isCancelled: true });
    const edited = eventOf("2026-11-21");
    graph.events.set(edited, { ...graph.events.get(edited)!, attendees: [{ address: "fremd@firma.at", name: null }] });
    const moved = eventOf("2026-11-28");
    const original = graph.events.get(moved)!;
    graph.events.set(moved, { ...original, start: { ...original.start, dateTime: "2026-11-28T10:00:00.0000000" } });

    expect(await verifyOutlook(graph, now, s.rotation.id)).toEqual({ drifted: 4, authError: null });
    graph.calls = [];
    expect(await sync()).toMatchObject({ created: 2, updated: 2 });
    expect(graph.attendeesOf(edited)).not.toContain("fremd@firma.at");
  });

  it("ignores Graph's fractional seconds when comparing times", async () => {
    const id = eventOf("2026-11-07");
    const e = graph.events.get(id)!;
    graph.events.set(id, {
      ...e,
      start: { ...e.start, dateTime: `${e.start.dateTime}.0000000` },
      end: { ...e.end, dateTime: `${e.end.dateTime}.0000000` },
    });
    expect((await verifyOutlook(graph, now, s.rotation.id)).drifted).toBe(0);
  });

  it("stops at an auth error", async () => {
    graph.failures.push(new GraphError(403, "403 ErrorAccessDenied"));
    expect(await verifyOutlook(graph, now, s.rotation.id)).toEqual({ drifted: 0, authError: "403 ErrorAccessDenied" });
    expect(graph.calls).toHaveLength(1);
  });
});
