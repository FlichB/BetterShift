import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, shiftSignups, shifts } from "@/lib/db/schema";
import { parseLocalDate } from "@/lib/date-utils";
import { shiftSwapHidden, shiftSwaps } from "@/lib/swap/schema";
import {
  acceptOffer,
  cancelOffer,
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

const offer = (shiftId: string, targetUserId: string | null = null) => ({
  shiftId,
  type: "exchange" as const,
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
    const swap = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    expect(swap).toMatchObject({ status: "open", type: "exchange", offeredByUserId: s.m0, targetUserId: null });
  });

  it("refuses to offer a duty that has begun", () => {
    const running = new Date(2026, 10, 7, 10, 0); // 11-07 09:30 has begun
    expect(code(() => createOffer(offer(s.duty("2026-11-07")), s.m0, running))).toBe("alreadyStarted");
  });

  it("rejects plain shifts, foreign Plätze and a second open offer", () => {
    expect(code(() => createOffer(offer("no-such-shift"), s.m0, now))).toBe("notDuty");
    expect(code(() => createOffer(offer(s.duty("2026-11-14")), s.m0, now))).toBe("slotNotOwned");
    createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    expect(code(() => createOffer(offer(s.duty("2026-11-07")), s.m0, now))).toBe("duplicateOffer");
  });

  it("lets only the offerer withdraw, once", () => {
    const swap = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    expect(code(() => withdrawOffer(swap.id, s.m2, now))).toBe("forbidden");
    expect(withdrawOffer(swap.id, s.m0, now).status).toBe("withdrawn");
    expect(code(() => withdrawOffer(swap.id, s.m0, now))).toBe("notOpen");
  });

  it("cancels an open offer once and leaves other offers alone", () => {
    const swap = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    expect(cancelOffer(swap.id, now)?.status).toBe("cancelled");
    expect(getSwap(swap.id)?.status).toBe("cancelled");
    expect(cancelOffer(swap.id, now)).toBeNull();
    const withdrawn = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    withdrawOffer(withdrawn.id, s.m0, now);
    expect(cancelOffer(withdrawn.id, now)).toBeNull();
    expect(getSwap(withdrawn.id)?.status).toBe("withdrawn");
  });

  it("lets only the target decline a Direktanfrage", () => {
    const broadcast = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    expect(code(() => declineOffer(broadcast.id, s.m2, now))).toBe("notDirect");
    withdrawOffer(broadcast.id, s.m0, now);

    const direct = createOffer(offer(s.duty("2026-11-07"), s.m2), s.m0, now);
    expect(code(() => declineOffer(direct.id, s.m3, now))).toBe("notTarget");
    expect(declineOffer(direct.id, s.m2, now).status).toBe("declined");
  });

  it("hides only broadcast offers, per user", () => {
    const broadcast = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    hideOffer(broadcast.id, s.m2);
    hideOffer(broadcast.id, s.m2); // idempotent
    const hiddenFor = (userId: string) =>
      db.select().from(shiftSwapHidden).where(and(eq(shiftSwapHidden.swapId, broadcast.id), eq(shiftSwapHidden.userId, userId))).all();
    expect(hiddenFor(s.m2)).toHaveLength(1);
    expect(hiddenFor(s.m3)).toHaveLength(0);
    expect(code(() => hideOffer(broadcast.id, s.m0))).toBe("ownOffer");
    unhideOffer(broadcast.id, s.m2);
    expect(hiddenFor(s.m2)).toHaveLength(0);

    const direct = createOffer(offer(s.duty("2026-11-14"), s.m0), s.m2, now);
    expect(code(() => hideOffer(direct.id, s.m0))).toBe("notBroadcast");
  });

  it("refuses to hide an offer that is no longer open", () => {
    const swap = createOffer(offer(s.duty("2026-11-14")), s.m2, now);
    withdrawOffer(swap.id, s.m2, now);
    expect(code(() => hideOffer(swap.id, s.m0))).toBe("notOpen");
  });

  it("settles a Direktanfrage whose requested duty changed hands", () => {
    const sat14 = s.duty("2026-11-14"); // m2, m3
    const direct = createOffer(
      { shiftId: s.duty("2026-11-07"), type: "exchange", targetUserId: s.m2, requestedShiftId: sat14, note: null },
      s.m0,
      now
    );
    // m2 hands 11-14 to m4 (for 11-21) — the requested duty is no longer m2's
    const away14 = createOffer(offer(sat14), s.m2, now);
    acceptOffer(away14.id, s.m4, s.duty("2026-11-21"), now);
    const resolved = expireDue(now);
    expect(resolved.find((r) => r.swap.id === direct.id)?.status).toBe("cancelled");
  });

  it("expires offers once the duty has begun and logs it", async () => {
    const swap = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    expect(expireDue(now).find((r) => r.swap.id === swap.id)).toBeUndefined();
    const resolved = expireDue(new Date(2026, 10, 7, 9, 30));
    expect(resolved.find((r) => r.swap.id === swap.id)?.status).toBe("expired");
    expect(getSwap(swap.id)?.status).toBe("expired");
    await new Promise((r) => setTimeout(r, 20)); // logResolved is fire-and-forget
    const logs = db.select().from(auditLogs).where(eq(auditLogs.resourceId, swap.id)).all();
    expect(logs.map((l) => l.action)).toContain("swap.expired");
  });

  it("audit-logs an offer cancelled because its Platz moved as swap.cancelled", async () => {
    const shiftId = s.duty("2026-11-07");
    const swap = createOffer(offer(shiftId), s.m0, now);
    db.update(shiftSignups)
      .set({ userId: s.m4 })
      .where(and(eq(shiftSignups.shiftId, shiftId), eq(shiftSignups.userId, s.m0)))
      .run();
    expireDue(now);
    await new Promise((r) => setTimeout(r, 20)); // logResolved is fire-and-forget
    const logs = db.select().from(auditLogs).where(eq(auditLogs.resourceId, swap.id)).all();
    expect(logs.map((l) => l.action)).toContain("swap.cancelled");
  });

  it("rejects a plain shift as the requested duty of an exchange", () => {
    const plain = db
      .insert(shifts)
      .values({ calendarId: s.team.calendarId, date: parseLocalDate("2026-11-10"), startTime: "08:00", endTime: "12:00", title: "Normal" })
      .returning()
      .get();
    const input = { shiftId: s.duty("2026-11-07"), type: "exchange" as const, targetUserId: null, requestedShiftId: plain.id, note: null };
    expect(code(() => createOffer(input, s.m0, now))).toBe("invalidShift");
  });

  it("cancels an open Abgabe on the next expiry run", () => {
    const row = db
      .insert(shiftSwaps)
      .values({ type: "give", offeredShiftId: s.duty("2026-11-07"), offeredByUserId: s.m0 })
      .returning()
      .get();
    expect(expireDue(now).map((r) => r.status)).toEqual(["cancelled"]);
    expect(getSwap(row.id)?.status).toBe("cancelled");
  });

  it("rejects an Abgabe (type give) as invalid", () => {
    const input = { ...offer(s.duty("2026-11-07")), type: "give" as const };
    expect(code(() => createOffer(input, s.m0, now))).toBe("invalid");
  });

  it("cancels offers whose Platz was reassigned by hand", () => {
    const shiftId = s.duty("2026-11-07");
    const swap = createOffer(offer(shiftId), s.m0, now);
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
