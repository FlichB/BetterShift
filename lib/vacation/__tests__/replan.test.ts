// [fork] Urlaub: preview and replanning across all rotations of a person (SPEC 12.43 points 3, 7).
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { vacations } from "@/lib/vacation/schema";
import { isManagerOf, isParticipant, managedUserIds } from "@/lib/vacation/permissions";
import { previewAction, runWithReplan } from "@/lib/vacation/replan";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { createUser } from "@/tests/helpers/seed";

describe("permissions", () => {
  it("knows Teilnehmer and their Verwaltung", async () => {
    const s = await seedDuties();
    expect(isParticipant(s.m1)).toBe(true);
    expect(isParticipant(createUser("Fremd"))).toBe(false);
    expect(await isManagerOf(s.team.ownerId, s.m1)).toBe(true);
    expect(await isManagerOf(s.m2, s.m1)).toBe(false);
    expect((await managedUserIds(s.team.ownerId)).has(s.m1)).toBe(true);
  });
});

describe("previewAction", () => {
  it("shows the Plätze that change, without writing", async () => {
    const s = await seedDuties();
    const preview = await previewAction({ kind: "enter", userId: s.m0, startDate: "2026-11-07", endDate: "2026-11-07" }, now);
    expect(preview.rotations).toHaveLength(1);
    const change = preview.rotations[0].changes.find((c) => c.date === "2026-11-07");
    expect(change?.before).toContain("M1");
    expect(change?.after).not.toContain("M1");
    expect(s.holders(s.duty("2026-11-07"))).toContain(s.m0);
  });
});

describe("runWithReplan", () => {
  it("writes the vacation and replans in one transaction", async () => {
    const s = await seedDuties();
    await runWithReplan(s.m0, "2026-11-07", s.team.ownerId, now, (tx) =>
      tx.insert(vacations).values({ userId: s.m0, startDate: "2026-11-07", endDate: "2026-11-21", status: "approved", requestedBy: s.team.ownerId }).run()
    );
    expect(s.holders(s.duty("2026-11-07"))).not.toContain(s.m0);
  });

  it("rolls everything back when a rotation fails", async () => {
    const s = await seedDuties();
    await expect(
      runWithReplan(s.m0, "2026-11-07", s.team.ownerId, now, (tx) => {
        tx.insert(vacations).values({ userId: s.m0, startDate: "2026-11-07", endDate: "2026-11-07", status: "approved", requestedBy: s.m0 }).run();
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(db.select().from(vacations).where(eq(vacations.userId, s.m0)).all()).toEqual([]);
    expect(s.holders(s.duty("2026-11-07"))).toContain(s.m0);
  });
});
