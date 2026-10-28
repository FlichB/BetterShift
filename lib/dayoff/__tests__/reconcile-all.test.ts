// [fork] The hourly reconcile keeps going when one rotation fails.
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { dayOffs } from "@/lib/dayoff/schema";
import { reconcileAll } from "@/lib/dayoff/service";
import { rotations } from "@/lib/rotation/schema";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";

const failing = vi.hoisted(() => ({ rotationId: "" }));

vi.mock("@/lib/dayoff/workdays", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dayoff/workdays")>();
  return {
    ...actual,
    loadClosedSet: (...args: Parameters<typeof actual.loadClosedSet>) => {
      if (args[1].id === failing.rotationId) throw new Error("broken rotation");
      return actual.loadClosedSet(...args);
    },
  };
});

describe("reconcileAll", () => {
  it("a throwing rotation does not stop the others", async () => {
    // The broken rotation is seeded first so it runs first.
    const broken = await seedDuties();
    const healthy = await seedDuties();
    for (const s of [broken, healthy]) db.update(rotations).set({ dayOffEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
    failing.rotationId = broken.rotation.id;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => reconcileAll(now)).not.toThrow();

    // The broken rotation's transaction rolled back; the healthy one got its Dienstfreie.
    expect(db.select().from(dayOffs).where(eq(dayOffs.rotationId, broken.rotation.id)).all()).toHaveLength(0);
    expect(db.select().from(dayOffs).where(eq(dayOffs.rotationId, healthy.rotation.id)).all()).toHaveLength(16);
    expect(errors).toHaveBeenCalledWith("[dayoff] reconcile failed", broken.rotation.id, expect.any(Error));
    errors.mockRestore();
  });
});
