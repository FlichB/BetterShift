import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shifts } from "@/lib/db/schema";
import { parseLocalDate } from "@/lib/date-utils";
import { shiftSwapHidden, shiftSwaps } from "@/lib/swap/schema";
import { seedTeam } from "@/tests/helpers/seed";

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
});
