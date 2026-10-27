// [fork] Dienstfrei follows the Platz on swaps (SPEC 12.38).
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dayOffProposals, dayOffs } from "@/lib/dayoff/schema";
import { reconcileRotation } from "@/lib/dayoff/service";
import { rotations } from "@/lib/rotation/schema";
import { createOffer, acceptOffer, forceSwap } from "@/lib/swap/service";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";

async function setup() {
  const s = await seedDuties();
  db.update(rotations).set({ dayOffEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
  db.transaction((tx) => reconcileRotation(tx, s.rotation.id, now));
  const of = (date: string, userId: string) =>
    db.select().from(dayOffs).where(and(eq(dayOffs.shiftId, s.duty(date)), eq(dayOffs.userId, userId))).get();
  return { ...s, of };
}

describe("Dienstfrei on swaps", () => {
  it("an exchange swaps both Dienstfreie, moved ones fall back to standard", async () => {
    const s = await setup();
    db.update(dayOffs).set({ status: "moved", date: "2026-11-11" }).where(eq(dayOffs.id, s.of("2026-11-07", s.m0)!.id)).run();
    const offer = createOffer({ shiftId: s.duty("2026-11-07"), type: "exchange", targetUserId: null, requestedShiftId: s.duty("2026-11-14"), note: null }, s.m0, now);
    acceptOffer(offer.id, s.m2, null, now);
    expect(s.of("2026-11-07", s.m2)).toMatchObject({ status: "standard", date: "2026-11-09" });
    expect(s.of("2026-11-14", s.m0)).toMatchObject({ status: "standard", date: "2026-11-16" });
    expect(s.of("2026-11-07", s.m0)).toBeUndefined();
  });

  it("a locked Dienstfrei stays locked and drops the old holder's proposals; agreed becomes locked", async () => {
    const s = await setup();
    const row = s.of("2026-11-07", s.m0)!;
    db.update(dayOffs).set({ status: "locked", date: null }).where(eq(dayOffs.id, row.id)).run();
    db.insert(dayOffProposals).values({ dayOffId: row.id, date: "2026-11-18", side: "holder", proposedByUserId: s.m0 }).run();
    const agreed = s.of("2026-11-14", s.m3)!;
    db.update(dayOffs).set({ status: "agreed", date: "2026-11-25" }).where(eq(dayOffs.id, agreed.id)).run();

    forceSwap({ shiftId: s.duty("2026-11-07"), absentUserId: s.m0, substituteUserId: s.m4, note: null }, s.team.ownerId, now);
    expect(s.of("2026-11-07", s.m4)).toMatchObject({ id: row.id, status: "locked", date: null });
    expect(db.select().from(dayOffProposals).where(eq(dayOffProposals.dayOffId, row.id)).get()).toMatchObject({ status: "void" });

    forceSwap({ shiftId: s.duty("2026-11-14"), absentUserId: s.m3, substituteUserId: s.m5, note: null }, s.team.ownerId, now);
    expect(s.of("2026-11-14", s.m5)).toMatchObject({ status: "locked", date: null });
  });
});
