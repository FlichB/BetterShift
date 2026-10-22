// [fork] Swap board service. Every write runs in one synchronous better-sqlite3
// transaction: read state, ask lib/swap/rules.ts, write. Due offers are settled
// in a separate transaction first, so their status sticks even if the request fails.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shiftSignups, shifts } from "@/lib/db/schema";
import { rotationDuties } from "@/lib/rotation/schema";
import { logResolved } from "@/lib/swap/audit";
import { checkOffer, dueStatus, type DutyTiming, type SlotView } from "@/lib/swap/rules";
import { shiftSwapHidden, shiftSwaps, type ShiftSwap } from "@/lib/swap/schema";
import type { SwapErrorCode, SwapType } from "@/lib/swap/types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;

export class SwapServiceError extends Error {
  constructor(public readonly code: SwapErrorCode) {
    super(code);
  }
}

export interface OfferInput {
  shiftId: string;
  type: SwapType;
  targetUserId: string | null;
  requestedShiftId: string | null;
  note: string | null;
}

export interface ResolvedSwap {
  swap: ShiftSwap;
  status: "expired" | "cancelled";
}

const dutyColumns = {
  shiftId: rotationDuties.shiftId,
  calendarId: shifts.calendarId,
  date: rotationDuties.date,
  startTime: shifts.startTime,
  endTime: shifts.endTime,
  isAllDay: shifts.isAllDay,
  title: shifts.title,
};

/** The duty behind a shift with its current holders, or null for a plain shift. */
export function loadSlot(tx: Reader, shiftId: string): SlotView | null {
  const duty = tx
    .select(dutyColumns)
    .from(rotationDuties)
    .innerJoin(shifts, eq(shifts.id, rotationDuties.shiftId))
    .where(eq(rotationDuties.shiftId, shiftId))
    .get();
  if (!duty) return null;
  const holderIds = tx
    .select({ userId: shiftSignups.userId })
    .from(shiftSignups)
    .where(eq(shiftSignups.shiftId, shiftId))
    .all()
    .map((s) => s.userId);
  return { duty, holderIds };
}

/** Every duty (any rotation, any calendar) the user holds a Platz in. */
export function dutiesOf(tx: Reader, userId: string): DutyTiming[] {
  return tx
    .select(dutyColumns)
    .from(shiftSignups)
    .innerJoin(rotationDuties, eq(rotationDuties.shiftId, shiftSignups.shiftId))
    .innerJoin(shifts, eq(shifts.id, shiftSignups.shiftId))
    .where(eq(shiftSignups.userId, userId))
    .all();
}

export function getSwap(id: string): ShiftSwap | null {
  return db.select().from(shiftSwaps).where(eq(shiftSwaps.id, id)).get() ?? null;
}

/** Calendar of a duty; null when the shift is no duty. */
export function dutyCalendarId(shiftId: string): string | null {
  return loadSlot(db, shiftId)?.duty.calendarId ?? null;
}

function loadOpen(tx: Tx, id: string): ShiftSwap {
  const swap = tx.select().from(shiftSwaps).where(eq(shiftSwaps.id, id)).get();
  if (!swap) throw new SwapServiceError("notFound");
  return swap;
}

function resolve(tx: Tx, id: string, status: ShiftSwap["status"], now: Date): ShiftSwap {
  return tx
    .update(shiftSwaps)
    .set({ status, resolvedAt: now })
    .where(and(eq(shiftSwaps.id, id), eq(shiftSwaps.status, "open")))
    .returning()
    .get();
}

/** Sets expired/cancelled on open offers that ended by themselves and logs them. */
export function expireDue(now: Date): ResolvedSwap[] {
  const resolved = db.transaction((tx) => {
    const out: ResolvedSwap[] = [];
    for (const swap of tx.select().from(shiftSwaps).where(eq(shiftSwaps.status, "open")).all()) {
      const offered = loadSlot(tx, swap.offeredShiftId);
      const requested = swap.requestedShiftId ? loadSlot(tx, swap.requestedShiftId) : null;
      const status = dueStatus(swap.offeredByUserId, offered, requested, swap.requestedShiftId, now);
      if (status) out.push({ swap: resolve(tx, swap.id, status, now), status });
    }
    return out;
  });
  if (resolved.length > 0) void logResolved(resolved);
  return resolved;
}

export function createOffer(input: OfferInput, offererId: string, now: Date): ShiftSwap {
  expireDue(now);
  return db.transaction((tx) => {
    const offered = loadSlot(tx, input.shiftId);
    if (!offered) throw new SwapServiceError("notDuty");
    const requested = input.requestedShiftId ? loadSlot(tx, input.requestedShiftId) : null;
    if (input.requestedShiftId && !requested) throw new SwapServiceError("invalidShift");
    const hasOpenOffer = Boolean(
      tx
        .select({ id: shiftSwaps.id })
        .from(shiftSwaps)
        .where(
          and(
            eq(shiftSwaps.offeredShiftId, input.shiftId),
            eq(shiftSwaps.offeredByUserId, offererId),
            eq(shiftSwaps.status, "open")
          )
        )
        .get()
    );
    const error = checkOffer({
      type: input.type,
      offererId,
      targetUserId: input.targetUserId,
      offered,
      requested,
      hasOpenOffer,
      now,
    });
    if (error) throw new SwapServiceError(error);
    return tx
      .insert(shiftSwaps)
      .values({
        type: input.type,
        offeredShiftId: input.shiftId,
        offeredByUserId: offererId,
        targetUserId: input.targetUserId,
        requestedShiftId: input.type === "exchange" ? input.requestedShiftId : null,
        note: input.note,
        createdAt: now,
      })
      .returning()
      .get();
  });
}

export function withdrawOffer(id: string, userId: string, now: Date): ShiftSwap {
  expireDue(now);
  return db.transaction((tx) => {
    const swap = loadOpen(tx, id);
    if (swap.offeredByUserId !== userId) throw new SwapServiceError("forbidden");
    if (swap.status !== "open") throw new SwapServiceError("notOpen");
    return resolve(tx, id, "withdrawn", now);
  });
}

export function declineOffer(id: string, userId: string, now: Date): ShiftSwap {
  expireDue(now);
  return db.transaction((tx) => {
    const swap = loadOpen(tx, id);
    if (!swap.targetUserId) throw new SwapServiceError("notDirect");
    if (swap.targetUserId !== userId) throw new SwapServiceError("notTarget");
    if (swap.status !== "open") throw new SwapServiceError("notOpen");
    return resolve(tx, id, "declined", now);
  });
}

export function hideOffer(id: string, userId: string): void {
  db.transaction((tx) => {
    const swap = loadOpen(tx, id);
    if (swap.targetUserId) throw new SwapServiceError("notBroadcast");
    if (swap.offeredByUserId === userId) throw new SwapServiceError("ownOffer");
    tx.insert(shiftSwapHidden).values({ swapId: id, userId }).onConflictDoNothing().run();
  });
}

export function unhideOffer(id: string, userId: string): void {
  db.delete(shiftSwapHidden)
    .where(and(eq(shiftSwapHidden.swapId, id), eq(shiftSwapHidden.userId, userId)))
    .run();
}
