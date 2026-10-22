import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, shiftSignups } from "@/lib/db/schema";
import { shiftSwapHidden } from "@/lib/swap/schema";
import {
  createOffer,
  declineOffer,
  expireDue,
  getSwap,
  hideOffer,
  SwapServiceError,
  unhideOffer,
  withdrawOffer,
} from "@/lib/swap/service";
import { now, seedDuties } from "./fixtures";

let s: Awaited<ReturnType<typeof seedDuties>>;
beforeEach(async () => {
  s = await seedDuties();
});

const give = (shiftId: string, targetUserId: string | null = null) => ({
  shiftId,
  type: "give" as const,
  targetUserId,
  requestedShiftId: null,
  note: null,
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof SwapServiceError) return e.code;
    throw e;
  }
  return null;
};

describe("offers", () => {
  it("creates an open offer for an own future Platz", () => {
    const swap = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    expect(swap).toMatchObject({ status: "open", type: "give", offeredByUserId: s.m0, targetUserId: null });
  });

  it("rejects plain shifts, foreign Plätze and a second open offer", () => {
    expect(code(() => createOffer(give("no-such-shift"), s.m0, now))).toBe("notDuty");
    expect(code(() => createOffer(give(s.duty("2026-11-14")), s.m0, now))).toBe("slotNotOwned");
    createOffer(give(s.duty("2026-11-07")), s.m0, now);
    expect(code(() => createOffer(give(s.duty("2026-11-07")), s.m0, now))).toBe("duplicateOffer");
  });

  it("lets only the offerer withdraw, once", () => {
    const swap = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    expect(code(() => withdrawOffer(swap.id, s.m2, now))).toBe("forbidden");
    expect(withdrawOffer(swap.id, s.m0, now).status).toBe("withdrawn");
    expect(code(() => withdrawOffer(swap.id, s.m0, now))).toBe("notOpen");
  });

  it("lets only the target decline a Direktanfrage", () => {
    const broadcast = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    expect(code(() => declineOffer(broadcast.id, s.m2, now))).toBe("notDirect");
    withdrawOffer(broadcast.id, s.m0, now);

    const direct = createOffer(give(s.duty("2026-11-07"), s.m2), s.m0, now);
    expect(code(() => declineOffer(direct.id, s.m3, now))).toBe("notTarget");
    expect(declineOffer(direct.id, s.m2, now).status).toBe("declined");
  });

  it("hides only broadcast offers, per user", () => {
    const broadcast = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    hideOffer(broadcast.id, s.m2);
    hideOffer(broadcast.id, s.m2); // idempotent
    const hiddenFor = (userId: string) =>
      db.select().from(shiftSwapHidden).where(and(eq(shiftSwapHidden.swapId, broadcast.id), eq(shiftSwapHidden.userId, userId))).all();
    expect(hiddenFor(s.m2)).toHaveLength(1);
    expect(hiddenFor(s.m3)).toHaveLength(0);
    expect(code(() => hideOffer(broadcast.id, s.m0))).toBe("ownOffer");
    unhideOffer(broadcast.id, s.m2);
    expect(hiddenFor(s.m2)).toHaveLength(0);

    const direct = createOffer(give(s.duty("2026-11-14"), s.m0), s.m2, now);
    expect(code(() => hideOffer(direct.id, s.m0))).toBe("notBroadcast");
  });

  it("expires offers once the duty has begun and logs it", async () => {
    const swap = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    expect(expireDue(now).find((r) => r.swap.id === swap.id)).toBeUndefined();
    const resolved = expireDue(new Date(2026, 10, 7, 9, 30));
    expect(resolved.find((r) => r.swap.id === swap.id)?.status).toBe("expired");
    expect(getSwap(swap.id)?.status).toBe("expired");
    await new Promise((r) => setTimeout(r, 20)); // logResolved is fire-and-forget
    const logs = db.select().from(auditLogs).where(eq(auditLogs.resourceId, swap.id)).all();
    expect(logs.map((l) => l.action)).toContain("swap.expired");
  });

  it("cancels offers whose Platz was reassigned by hand", () => {
    const shiftId = s.duty("2026-11-07");
    const swap = createOffer(give(shiftId), s.m0, now);
    db.update(shiftSignups)
      .set({ userId: s.m4 })
      .where(and(eq(shiftSignups.shiftId, shiftId), eq(shiftSignups.userId, s.m0)))
      .run();
    const resolved = expireDue(now);
    expect(resolved.find((r) => r.swap.id === swap.id)?.status).toBe("cancelled");
    expect(getSwap(swap.id)?.status).toBe("cancelled");
    expect(expireDue(now).find((r) => r.swap.id === swap.id)).toBeUndefined();
  });
});
