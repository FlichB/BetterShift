// [fork] Recipients of the forced-swap notification kinds.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resolveRecipients } from "@/lib/notify/recipients";
import { shiftSwaps } from "@/lib/swap/schema";
import { seedDuties } from "@/lib/swap/__tests__/fixtures";

let s: Awaited<ReturnType<typeof seedDuties>>;
beforeEach(async () => {
  s = await seedDuties();
});

const forced = (over: Partial<typeof shiftSwaps.$inferInsert> = {}) =>
  db
    .insert(shiftSwaps)
    .values({ type: "forced", offeredShiftId: s.duty("2026-11-07"), offeredByUserId: s.m0, forcedByUserId: s.team.ownerId, ...over })
    .returning()
    .get();
const ids = async (kind: Parameters<typeof resolveRecipients>[0], swap: ReturnType<typeof forced>) =>
  (await resolveRecipients(kind, swap, s.team.calendarId, s.team.ownerId)).map((r) => r.id).sort();

describe("forced swap recipients", () => {
  it("addresses everyone except the duty's holders for an open forced swap", async () => {
    const swap = forced();
    const result = await ids("forced_to_all", swap);
    expect(result).not.toContain(s.m0);
    expect(result).not.toContain(s.m1);
    expect(result).toContain(s.m2);
  });

  it("addresses the named Einspringer and the absent user", async () => {
    const swap = forced({ status: "accepted", targetUserId: s.m2, acceptedByUserId: s.m2, counterStatus: "pending" });
    expect(await ids("forced_to_me", swap)).toEqual([s.m2]);
    expect(await ids("duty_transferred", swap)).toEqual([s.m0]);
    expect(await ids("counter_chosen", swap)).toEqual([s.m0]);
  });
});
