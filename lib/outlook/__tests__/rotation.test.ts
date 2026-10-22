import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { outlookEvents } from "@/lib/outlook/schema";
import { outlookStatus, setOutlookEnabled } from "@/lib/outlook/rotation";
import { syncOutlook } from "@/lib/outlook/sync";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { FakeGraph } from "@/tests/helpers/fake-graph";

let s: Awaited<ReturnType<typeof seedDuties>>;
beforeEach(async () => {
  vi.stubEnv("OUTLOOK_ORGANIZER", "office@firma.at");
  vi.stubEnv("OUTLOOK_DRY_RUN", "true");
  s = await seedDuties();
});
afterEach(() => vi.unstubAllEnvs());

describe("outlookStatus", () => {
  it("counts pending, synced and failed duties", async () => {
    expect(setOutlookEnabled(s.rotation.id, true)).toBe(true);
    expect(outlookStatus(s.rotation.id, true, now)).toMatchObject({ configured: true, enabled: true, total: 8, synced: 0, pending: 8, failed: 0 });

    const graph = new FakeGraph();
    graph.failures.push(new Error("boom"));
    await syncOutlook(graph, now, { bodyHtml: "", cancelComment: "", rotationId: s.rotation.id });
    const status = outlookStatus(s.rotation.id, true, now);
    expect(status).toMatchObject({ total: 8, synced: 7, failed: 1, pending: 0 });
    expect(status.errors).toEqual([{ date: "2026-11-07", message: "boom" }]);
    expect(status.lastSyncedAt).toBe(now.toISOString());
  });

  it("reports an unknown rotation as not updated", () => {
    expect(setOutlookEnabled("nope", true)).toBe(false);
  });

  it("is unconfigured without env", () => {
    vi.unstubAllEnvs();
    expect(outlookStatus(s.rotation.id, false, now).configured).toBe(false);
    expect(db.select().from(outlookEvents).where(eq(outlookEvents.rotationId, s.rotation.id)).all()).toEqual([]);
  });
});
