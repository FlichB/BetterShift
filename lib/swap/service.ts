// [fork] Swap board service. Every write runs in one synchronous better-sqlite3
// transaction: read state, ask lib/swap/rules.ts, write. Due offers are settled
// in a separate transaction first, so their status sticks even if the request fails.
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { shiftSignups, shifts } from "@/lib/db/schema";
import { rotationDuties, rotationSlotLocks } from "@/lib/rotation/schema";
import { logResolved } from "@/lib/swap/audit";
import { checkAccept, checkOffer, dueStatus, nextLock, type DutyTiming, type SlotMove, type SlotView } from "@/lib/swap/rules";
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

export interface AcceptResult {
  swap: ShiftSwap;
  moves: SlotMove[];
  cancelled: ResolvedSwap[];
}

/** Hands one Platz over and carries its lock along (see nextLock). */
function applyMove(tx: Tx, move: SlotMove, actorId: string, now: Date): void {
  const fromLock = and(eq(rotationSlotLocks.shiftId, move.shiftId), eq(rotationSlotLocks.userId, move.fromUserId));
  const existing = tx.select().from(rotationSlotLocks).where(fromLock).get() ?? null;
  tx.update(shiftSignups)
    .set({ userId: move.toUserId, signedUpBy: actorId })
    .where(and(eq(shiftSignups.shiftId, move.shiftId), eq(shiftSignups.userId, move.fromUserId)))
    .run();
  if (existing) tx.delete(rotationSlotLocks).where(fromLock).run();
  const lock = nextLock(move, existing);
  if (lock) {
    tx.insert(rotationSlotLocks)
      .values({ ...lock, lockedAt: now })
      .onConflictDoUpdate({
        target: [rotationSlotLocks.shiftId, rotationSlotLocks.userId],
        set: { replacesUserId: lock.replacesUserId, lockedAt: now },
      })
      .run();
  }
}

export function acceptOffer(id: string, acceptorId: string, counterShiftId: string | null, now: Date): AcceptResult {
  expireDue(now);
  const result = db.transaction((tx): AcceptResult => {
    const swap = loadOpen(tx, id);
    if (swap.status !== "open") throw new SwapServiceError("notOpen");
    const offered = loadSlot(tx, swap.offeredShiftId);
    if (!offered) throw new SwapServiceError("notOpen");

    const counterId = swap.type === "exchange" ? (swap.requestedShiftId ?? counterShiftId) : null;
    const counter = counterId ? loadSlot(tx, counterId) : null;
    if (counterId && !counter) throw new SwapServiceError("invalidShift");

    const check = checkAccept({
      offer: swap,
      acceptorId,
      offered,
      counter,
      acceptorDuties: dutiesOf(tx, acceptorId),
      offererDuties: dutiesOf(tx, swap.offeredByUserId),
      now,
    });
    if (!check.ok) throw new SwapServiceError(check.error);

    for (const move of check.moves) applyMove(tx, move, acceptorId, now);
    const accepted = tx
      .update(shiftSwaps)
      .set({ status: "accepted", acceptedByUserId: acceptorId, acceptedShiftId: counterId, resolvedAt: now })
      .where(eq(shiftSwaps.id, id))
      .returning()
      .get();

    // Open offers of a Platz that just changed hands can no longer be honoured.
    const cancelled: ResolvedSwap[] = [];
    for (const move of check.moves) {
      const rows = tx
        .update(shiftSwaps)
        .set({ status: "cancelled", resolvedAt: now })
        .where(
          and(
            eq(shiftSwaps.status, "open"),
            eq(shiftSwaps.offeredShiftId, move.shiftId),
            eq(shiftSwaps.offeredByUserId, move.fromUserId),
            ne(shiftSwaps.id, id)
          )
        )
        .returning()
        .all();
      cancelled.push(...rows.map((swap) => ({ swap, status: "cancelled" as const })));
    }
    return { swap: accepted, moves: check.moves, cancelled };
  });
  if (result.cancelled.length > 0) void logResolved(result.cancelled);
  return result;
}
