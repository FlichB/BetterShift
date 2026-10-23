import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shifts, user } from "@/lib/db/schema";
import { parseLocalDate } from "@/lib/date-utils";
import { shiftSwapHidden, shiftSwaps } from "@/lib/swap/schema";
import { acceptOffer, createOffer, getSwap } from "@/lib/swap/service";
import { seedTeam } from "@/tests/helpers/seed";
import { now, seedDuties } from "./fixtures";

function seedShift(calendarId: string) {
  return db
    .insert(shifts)
    .values({
      calendarId,
      date: parseLocalDate("2026-11-07"),
      startTime: "09:30",
      endTime: "15:00",
      title: "Samstagsdienst",
    })
    .returning()
    .get();
}

describe("swap schema", () => {
  it("allows only one open offer per Platz", () => {
    const team = seedTeam({ members: 2 });
    const shift = seedShift(team.calendarId);
    const offer = { type: "give" as const, offeredShiftId: shift.id, offeredByUserId: team.memberIds[0] };
    db.insert(shiftSwaps).values(offer).run();
    expect(() => db.insert(shiftSwaps).values(offer).run()).toThrow(/UNIQUE/);
    // Resolved offers do not count
    db.insert(shiftSwaps).values({ ...offer, status: "withdrawn" }).run();
  });

  it("drops offers and hidden markers together with the shift", () => {
    const team = seedTeam({ members: 2 });
    const shift = seedShift(team.calendarId);
    const swap = db
      .insert(shiftSwaps)
      .values({ type: "give", offeredShiftId: shift.id, offeredByUserId: team.memberIds[0] })
      .returning()
      .get();
    db.insert(shiftSwapHidden).values({ swapId: swap.id, userId: team.memberIds[1] }).run();

    db.delete(shifts).where(eq(shifts.id, shift.id)).run();

    expect(db.select().from(shiftSwaps).where(eq(shiftSwaps.id, swap.id)).all()).toHaveLength(0);
    expect(db.select().from(shiftSwapHidden).where(eq(shiftSwapHidden.swapId, swap.id)).all()).toHaveLength(0);
  });

  it("drops an exchange offer with its requested duty and keeps accepted offers when the counter duty goes", async () => {
    const s = await seedDuties();
    const a = s.duty("2026-11-07"); // m0, m1
    const b = s.duty("2026-11-14"); // m2, m3
    const c = s.duty("2026-11-21"); // m4, m5

    // An exchange that requests duty b disappears together with b.
    const requesting = createOffer(
      { shiftId: a, type: "exchange", targetUserId: null, requestedShiftId: b, note: null },
      s.m0,
      now
    );
    expect(getSwap(requesting.id)?.requestedShiftId).toBe(b);
    db.delete(shifts).where(eq(shifts.id, b)).run();
    expect(getSwap(requesting.id)).toBeNull();

    // An accepted Tausch beliebig keeps its row when the counter duty or the acceptor goes.
    const any = createOffer(
      { shiftId: a, type: "exchange", targetUserId: null, requestedShiftId: null, note: null },
      s.m0,
      now
    );
    acceptOffer(any.id, s.m4, c, now);
    expect(getSwap(any.id)).toMatchObject({ status: "accepted", acceptedShiftId: c, acceptedByUserId: s.m4 });

    db.delete(shifts).where(eq(shifts.id, c)).run();
    expect(getSwap(any.id)).toMatchObject({ status: "accepted", acceptedShiftId: null, acceptedByUserId: s.m4 });

    db.delete(user).where(eq(user.id, s.m4)).run();
    expect(getSwap(any.id)).toMatchObject({ status: "accepted", acceptedShiftId: null, acceptedByUserId: null });
  });

  it("names the unique open-offer index", () => {
    const row = db.$client
      .prepare("select sql from sqlite_master where name = 'shift_swaps_open_slot_idx'")
      .get() as { sql: string };
    expect(row.sql).toMatch(/UNIQUE INDEX .shift_swaps_open_slot_idx./);
  });
});
