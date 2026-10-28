import { beforeEach, describe, expect, it } from "vitest";
import { createRotation, runGeneration } from "@/lib/rotation/service";
import { acceptOffer, createOffer, getSwap, SwapServiceError, withdrawOffer } from "@/lib/swap/service";
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
const offer = (shiftId: string, by: string, over: Partial<Parameters<typeof createOffer>[0]> = {}) =>
  createOffer({ shiftId, type: "exchange", targetUserId: null, requestedShiftId: null, note: null, ...over }, by, now);

describe("acceptOffer", () => {
  it("hands a Platz to the acceptor against a counter duty and locks it against the planned Teilnehmer", () => {
    const sat = s.duty("2026-11-07");
    const swap = offer(sat, s.m0);
    const result = acceptOffer(swap.id, s.m2, s.duty("2026-11-14"), now);

    expect(result.swap).toMatchObject({ status: "accepted", acceptedByUserId: s.m2 });
    expect(s.holders(sat)).toEqual(sorted(s.m1, s.m2));
    expect(s.locks(sat)).toMatchObject([{ userId: s.m2, replacesUserId: s.m0 }]);
  });

  it("swaps two duties in one step", () => {
    const a = s.duty("2026-11-07");
    const b = s.duty("2026-11-14");
    const swap = offer(a, s.m0, { type: "exchange", requestedShiftId: b });
    acceptOffer(swap.id, s.m2, null, now);

    expect(s.holders(a)).toEqual(sorted(s.m1, s.m2));
    expect(s.holders(b)).toEqual(sorted(s.m0, s.m3));
    expect(getSwap(swap.id)).toMatchObject({ acceptedShiftId: b });
  });

  it("lets the acceptor pick the counter duty for a Tausch beliebig", () => {
    const a = s.duty("2026-11-07");
    const swap = offer(a, s.m0, { type: "exchange" });
    expect(code(() => acceptOffer(swap.id, s.m2, null, now))).toBe("invalid");
    acceptOffer(swap.id, s.m2, s.duty("2026-12-05"), now);
    expect(s.holders(s.duty("2026-12-05"))).toContain(s.m0);
  });

  it("locks the counter Platz for the offerer against the acceptor on a concrete exchange", () => {
    const a = s.duty("2026-11-07");
    const b = s.duty("2026-11-14"); // m2, m3
    const swap = offer(a, s.m0, { type: "exchange", requestedShiftId: b });
    acceptOffer(swap.id, s.m2, null, now);
    expect(s.locks(b)).toMatchObject([{ userId: s.m0, replacesUserId: s.m2 }]);
    expect(s.locks(a)).toMatchObject([{ userId: s.m2, replacesUserId: s.m0 }]);
  });

  it("stores the chosen counter duty of a Tausch beliebig as accepted", () => {
    const counter = s.duty("2026-12-05");
    const swap = offer(s.duty("2026-11-07"), s.m0, { type: "exchange" });
    acceptOffer(swap.id, s.m2, counter, now);
    expect(getSwap(swap.id)).toMatchObject({ status: "accepted", acceptedShiftId: counter });
  });

  it("refuses an acceptor already on the offered duty and the offerer accepting their own offer", () => {
    const swap = offer(s.duty("2026-11-07"), s.m0); // m0, m1
    expect(code(() => acceptOffer(swap.id, s.m1, s.duty("2026-11-14"), now))).toBe("alreadyOnDuty");
    expect(code(() => acceptOffer(swap.id, s.m0, s.duty("2026-11-14"), now))).toBe("ownOffer");
    expect(getSwap(swap.id)?.status).toBe("open");
  });

  it("lets only one of two acceptances win", () => {
    const swap = offer(s.duty("2026-11-07"), s.m0);
    acceptOffer(swap.id, s.m2, s.duty("2026-11-14"), now);
    expect(code(() => acceptOffer(swap.id, s.m3, s.duty("2026-11-14"), now))).toBe("notOpen");
    expect(s.holders(s.duty("2026-11-07"))).toEqual(sorted(s.m1, s.m2));
  });

  it("fails cleanly on a withdrawn offer and leaves the Plätze alone", () => {
    const swap = offer(s.duty("2026-11-07"), s.m0);
    withdrawOffer(swap.id, s.m0, now);
    expect(code(() => acceptOffer(swap.id, s.m2, s.duty("2026-11-14"), now))).toBe("notOpen");
    expect(s.holders(s.duty("2026-11-07"))).toEqual(sorted(s.m0, s.m1));
  });

  it("refuses a Direktanfrage for anyone but the target", () => {
    const swap = offer(s.duty("2026-11-07"), s.m0, { targetUserId: s.m2 });
    expect(code(() => acceptOffer(swap.id, s.m3, s.duty("2026-11-14"), now))).toBe("notTarget");
    acceptOffer(swap.id, s.m2, s.duty("2026-11-14"), now);
  });

  it("refuses a Doppelbelegung across rotations and rolls back", async () => {
    // A second rotation puts m2 on Saturdays at the same time
    const other = createRotation(
      {
        name: "Samstag B",
        calendarId: s.team.calendarId,
        presetId: s.team.presetId,
        memberIds: [s.m2],
        perShift: 1,
        period: "week",
        periodDays: null,
        startDate: "2026-11-02",
        startOffset: 0,
        weekdays: [6],
        skipDates: [],
        closedTitle: "Geschlossen",
        entryTitle: "{Vorname} Dienst",
        dayOffEnabled: false,
        dayOffTitle: "{Vorname} dienstfrei",
        dayOffExcludedIds: [],
        yearlyFairness: false,
        reinforcedDates: [],
        holidayCalendarId: null,
        holidayOpenDates: [],
      },
      s.team.ownerId
    );
    await runGeneration(other.id, "2026-11-02", "2026-11-08", s.team.ownerId, now);
    const swap = offer(s.duty("2026-11-07"), s.m0);
    expect(code(() => acceptOffer(swap.id, s.m2, s.duty("2026-11-14"), now))).toBe("doubleBooked");
    expect(getSwap(swap.id)?.status).toBe("open");
    expect(s.holders(s.duty("2026-11-07"))).toEqual(sorted(s.m0, s.m1));
  });

  it("refuses a duty that has begun", () => {
    const swap = offer(s.duty("2026-11-07"), s.m0);
    expect(code(() => acceptOffer(swap.id, s.m2, s.duty("2026-11-14"), new Date(2026, 10, 7, 9, 30)))).toBe("notOpen");
    expect(getSwap(swap.id)?.status).toBe("expired");
  });

  it("cancels other open offers of a Platz that moved", () => {
    const a = s.duty("2026-11-07");
    const b = s.duty("2026-11-14");
    const mine = offer(b, s.m2); // m2 offers 11-14 to everyone
    const theirs = offer(a, s.m0, { type: "exchange", requestedShiftId: b });
    const result = acceptOffer(theirs.id, s.m2, null, now); // m2's 11-14 Platz moves to m0
    expect(result.cancelled.map((c) => c.swap.id)).toEqual([mine.id]);
    expect(getSwap(mine.id)?.status).toBe("cancelled");
  });

  it("keeps the planned Teilnehmer over two swaps and unlocks on the way back", () => {
    const sat = s.duty("2026-11-07");
    const c14 = s.duty("2026-11-14"); // m2, m3
    acceptOffer(offer(sat, s.m0, { requestedShiftId: c14 }).id, s.m2, null, now);
    acceptOffer(offer(sat, s.m2, { requestedShiftId: c14 }).id, s.m3, null, now);
    expect(s.locks(sat)).toMatchObject([{ userId: s.m3, replacesUserId: s.m0 }]);
    acceptOffer(offer(sat, s.m3, { requestedShiftId: c14 }).id, s.m0, null, now);
    expect(s.locks(sat)).toHaveLength(0);
  });

  it("survives regeneration with the swapped Platz intact", async () => {
    const sat = s.duty("2026-11-07");
    acceptOffer(offer(sat, s.m0).id, s.m2, s.duty("2026-11-14"), now);
    await runGeneration(s.rotation.id, "2026-11-02", "2026-12-27", s.team.ownerId, now);
    expect(s.holders(sat)).toEqual(sorted(s.m1, s.m2));
  });
});
