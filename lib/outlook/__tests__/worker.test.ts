import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { GraphError } from "@/lib/outlook/graph-client";
import { isFullRunDue, outlookWorker } from "@/lib/outlook/worker";
import { rotations } from "@/lib/rotation/schema";
import { seedDuties } from "@/lib/swap/__tests__/fixtures";
import { FakeGraph } from "@/tests/helpers/fake-graph";

// The worker builds its client through graphClientFor; hand it the shared FakeGraph instead.
const hoisted = vi.hoisted(() => ({ graph: null as unknown }));
vi.mock("@/lib/outlook/graph-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/outlook/graph-client")>()),
  graphClientFor: () => hoisted.graph,
}));

describe("isFullRunDue", () => {
  it("runs once per day from 03:00 local time", () => {
    expect(isFullRunDue(null, new Date(2026, 10, 7, 2, 59))).toBe(false);
    expect(isFullRunDue(null, new Date(2026, 10, 7, 3, 0))).toBe(true);
    expect(isFullRunDue("2026-11-07", new Date(2026, 10, 7, 23, 0))).toBe(false);
    expect(isFullRunDue("2026-11-06", new Date(2026, 10, 7, 4, 0))).toBe(true);
  });
});

describe("outlookWorker", () => {
  afterEach(() => {
    outlookWorker.stop();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not start and ignores kicks without configuration", () => {
    expect(() => {
      outlookWorker.start();
      outlookWorker.kick();
      outlookWorker.stop();
    }).not.toThrow();
  });

  it("pauses after a rejected login and ignores kicks during the pause", async () => {
    const s = await seedDuties();
    db.update(rotations).set({ outlookEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
    const graph = new FakeGraph();
    graph.failures.push(new GraphError(401, "bad"));
    hoisted.graph = graph;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("OUTLOOK_ORGANIZER", "office@firma.at");
    vi.stubEnv("OUTLOOK_DRY_RUN", "true");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

    const authRows = () => db.select().from(auditLogs).where(eq(auditLogs.action, "outlook.auth_failed")).all();
    outlookWorker.start();
    await vi.waitFor(() => expect(authRows()).toHaveLength(1));
    expect(graph.calls).toHaveLength(1);

    // Paused: the debounced run starts but must not reach Graph.
    const callsBefore = [...graph.calls];
    outlookWorker.kick();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(graph.calls).toEqual(callsBefore);
    expect(authRows()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1); // the kick timer fired; only the interval is left
  });
});
