// [fork] Service tests for the forced swap and the Ausgleich.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shiftSwaps } from "@/lib/swap/schema";
import {
  acceptOffer,
  chooseCounter,
  createOffer,
  declineOffer,
  expireDue,
  forceSwap,
  getSwap,
  hideOffer,
  listCounterCandidates,
  SwapServiceError,
  waiveCounter,
  withdrawOffer,
} from "@/lib/swap/service";
import { now, seedDuties, sorted } from "./fixtures";

let s: Awaited<ReturnType<typeof seedDuties>>;
beforeEach(async () => {
  s = await seedDuties();
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
const force = (date: string, absent: string, substitute: string | null, at: Date = now) =>
  forceSwap({ shiftId: s.duty(date), absentUserId: absent, substituteUserId: substitute, note: "Krankenstand" }, s.team.ownerId, at);

describe("forced offer protection", () => {
  it("keeps the absent user from ending an open forced offer by giving that duty as a counter", () => {
    force("2026-11-07", s.m0, null); // open to everyone, m0 absent
    const exchange = createOffer(
      { shiftId: s.duty("2026-11-21"), type: "exchange", targetUserId: null, requestedShiftId: null, note: null },
      s.m4,
      now
    );
    expect(code(() => acceptOffer(exchange.id, s.m0, s.duty("2026-11-07"), now))).toBe("slotNotOwned");
    expect(db.select().from(shiftSwaps).where(eq(shiftSwaps.offeredShiftId, s.duty("2026-11-07"))).get()?.status).toBe("open");
  });
});

describe("forceSwap", () => {
  it("hands the Platz to a named Einspringer at once and opens the Ausgleich", () => {
    const { swap } = force("2026-11-07", s.m0, s.m2);
    expect(swap).toMatchObject({
      type: "forced",
      status: "accepted",
      acceptedByUserId: s.m2,
      forcedByUserId: s.team.ownerId,
      counterStatus: "pending",
      counterWindowEnd: "2027-02-07",
    });
    expect(s.holders(s.duty("2026-11-07"))).toEqual(sorted(s.m1, s.m2));
    expect(s.locks(s.duty("2026-11-07"))).toMatchObject([{ userId: s.m2, replacesUserId: s.m0 }]);
  });

  it("works on the day of the duty after it began, not the day after", () => {
    expect(force("2026-11-07", s.m0, s.m2, new Date(2026, 10, 7, 10, 0)).swap.status).toBe("accepted");
    expect(code(() => force("2026-11-14", s.m2, s.m4, new Date(2026, 10, 15, 8, 0)))).toBe("alreadyStarted");
  });

  it("cancels the absent user's open offer for that Platz", () => {
    const offer = createOffer(
      { shiftId: s.duty("2026-11-07"), type: "exchange", targetUserId: null, requestedShiftId: null, note: null },
      s.m0,
      now
    );
    const { cancelled } = force("2026-11-07", s.m0, s.m2);
    expect(cancelled.map((c) => c.swap.id)).toEqual([offer.id]);
    expect(getSwap(offer.id)?.status).toBe("cancelled");
  });

  it("puts an open forced offer on the board that someone takes over", () => {
    const { swap, moves } = force("2026-11-07", s.m0, null);
    expect(moves).toEqual([]);
    expect(swap).toMatchObject({ status: "open", counterStatus: null });
    expect(code(() => hideOffer(swap.id, s.m4))).toBe("invalid");
    expect(code(() => declineOffer(swap.id, s.m4, now))).toBe("notDirect");
    expect(code(() => acceptOffer(swap.id, s.m4, s.duty("2026-11-21"), now))).toBe("invalid");

    const accepted = acceptOffer(swap.id, s.m4, null, now).swap;
    expect(accepted).toMatchObject({ status: "accepted", acceptedByUserId: s.m4, counterStatus: "pending", counterWindowEnd: "2027-02-07" });
    expect(s.holders(s.duty("2026-11-07"))).toEqual(sorted(s.m1, s.m4));
  });

  it("lets only the management withdraw an open forced offer", () => {
    const { swap } = force("2026-11-07", s.m0, null);
    expect(code(() => withdrawOffer(swap.id, s.m0, now))).toBe("forbidden");
    expect(withdrawOffer(swap.id, s.team.ownerId, now, true).status).toBe("withdrawn");
  });

  it("expires an open forced offer only after the day of the duty", () => {
    const { swap } = force("2026-11-07", s.m0, null);
    expireDue(new Date(2026, 10, 7, 14, 0));
    expect(getSwap(swap.id)?.status).toBe("open");
    expireDue(new Date(2026, 10, 8, 0, 1));
    expect(getSwap(swap.id)?.status).toBe("expired");
  });
});

describe("Ausgleich", () => {
  it("lets the Einspringer hand one of their duties to the absent user", () => {
    const { swap } = force("2026-11-07", s.m0, s.m2); // m2 holds 11-07, 11-14, 12-05 now
    expect(listCounterCandidates(swap.id, now)).toEqual({
      duties: [expect.objectContaining({ shiftId: s.duty("2026-11-14") }), expect.objectContaining({ shiftId: s.duty("2026-12-05") })],
      windowEnd: "2027-02-07",
    });

    const result = chooseCounter(swap.id, s.duty("2026-11-14"), s.m2, now);
    expect(result.swap).toMatchObject({ counterStatus: "chosen", acceptedShiftId: s.duty("2026-11-14"), counterResolvedByUserId: s.m2 });
    expect(s.holders(s.duty("2026-11-14"))).toEqual(sorted(s.m0, s.m3));
    expect(s.locks(s.duty("2026-11-14"))).toMatchObject([{ userId: s.m0, replacesUserId: s.m2 }]);
    expect(code(() => chooseCounter(swap.id, s.duty("2026-12-05"), s.m2, now))).toBe("counterNotDue");
  });

  it("refuses the taken-over duty, a duty the absent user holds and one outside the window", () => {
    const { swap } = force("2026-11-07", s.m0, s.m3); // m3 holds 11-07, 11-14, 12-12; m0 holds 12-12
    expect(code(() => chooseCounter(swap.id, s.duty("2026-11-07"), s.m3, now))).toBe("invalidShift");
    expect(code(() => chooseCounter(swap.id, s.duty("2026-12-12"), s.m3, now))).toBe("alreadyOnDuty");
    db.update(shiftSwaps).set({ counterWindowEnd: "2026-11-10" }).where(eq(shiftSwaps.id, swap.id)).run();
    expect(code(() => chooseCounter(swap.id, s.duty("2026-11-14"), s.m3, now))).toBe("outsideWindow");
  });

  it("lets the management choose on behalf or waive", () => {
    const first = force("2026-11-07", s.m0, s.m2).swap;
    chooseCounter(first.id, s.duty("2026-12-05"), s.team.ownerId, now);
    expect(getSwap(first.id)).toMatchObject({ counterStatus: "chosen", counterResolvedByUserId: s.team.ownerId });

    const second = force("2026-11-21", s.m4, s.team.memberIds[6]).swap;
    expect(waiveCounter(second.id, "Kein Dienst im Fenster", s.team.ownerId, now)).toMatchObject({
      counterStatus: "waived",
      waiveReason: "Kein Dienst im Fenster",
      counterResolvedByUserId: s.team.ownerId,
    });
    expect(code(() => waiveCounter(second.id, "nochmal", s.team.ownerId, now))).toBe("counterNotDue");
  });
});
