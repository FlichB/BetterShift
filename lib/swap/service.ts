// [fork] Swap board service. Every write runs in one synchronous better-sqlite3
// transaction: read state, ask lib/swap/rules.ts, write. Due offers are settled
// in a separate transaction first, so their status sticks even if the request fails.
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars, shiftSignups, shifts, user } from "@/lib/db/schema";
import { enqueueSwapEvent, offerKind } from "@/lib/notify/enqueue";
import { hasStarted } from "@/lib/rotation/dates";
import { rotationDuties, rotationSlotLocks } from "@/lib/rotation/schema";
import { logResolved } from "@/lib/swap/audit";
import { checkAccept, checkOffer, dueStatus, nextLock, type DutyTiming, type SlotMove, type SlotView } from "@/lib/swap/rules";
import { shiftSwapHidden, shiftSwaps, type ShiftSwap } from "@/lib/swap/schema";
import type { Board, BoardEntry, CalendarSwapState, DutyInfo, DutyListEntry, Person, SwapErrorCode, SwapType } from "@/lib/swap/types";

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

const logFailed = (error: unknown) => console.error("[Swap] Failed to log resolved offers:", error);

/** Cancels one offer that is still open; null when it was no longer open. */
export function cancelOffer(id: string, now: Date): ShiftSwap | null {
  return db.transaction((tx) => resolve(tx, id, "cancelled", now) ?? null);
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
  if (resolved.length > 0) void logResolved(resolved).catch(logFailed);
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
    const swap = tx
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
    enqueueSwapEvent(tx, offerKind(swap), swap, offererId, now);
    return swap;
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
    const declined = resolve(tx, id, "declined", now);
    enqueueSwapEvent(tx, "offer_declined", declined, userId, now);
    return declined;
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
    enqueueSwapEvent(tx, "offer_accepted", accepted, acceptorId, now);

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
  if (result.cancelled.length > 0) void logResolved(result.cancelled).catch(logFailed);
  return result;
}

const HISTORY_MS = 30 * 86_400_000;

function dutyInfos(shiftIds: string[]): Map<string, DutyInfo> {
  if (shiftIds.length === 0) return new Map();
  const rows = db
    .select(dutyColumns)
    .from(rotationDuties)
    .innerJoin(shifts, eq(shifts.id, rotationDuties.shiftId))
    .where(inArray(rotationDuties.shiftId, shiftIds))
    .all();
  return new Map(rows.map((r) => [r.shiftId, r]));
}

function people(userIds: string[]): Map<string, Person> {
  if (userIds.length === 0) return new Map();
  const rows = db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)).all();
  return new Map(rows.map((r) => [r.id, r]));
}

export function listBoard(
  userId: string,
  calendarIds: string[],
  now: Date,
  includeHidden: boolean
): Omit<Board, "calendars"> {
  expireDue(now);
  const empty = { forMe: [], mine: [], hidden: [] };
  if (calendarIds.length === 0) return empty;

  const rows = db
    .select({ swap: shiftSwaps, calendarName: calendars.name })
    .from(shiftSwaps)
    .innerJoin(shifts, eq(shifts.id, shiftSwaps.offeredShiftId))
    .innerJoin(calendars, eq(calendars.id, shifts.calendarId))
    .where(inArray(shifts.calendarId, calendarIds))
    .all();
  const hiddenIds = new Set(
    db
      .select({ swapId: shiftSwapHidden.swapId })
      .from(shiftSwapHidden)
      .where(eq(shiftSwapHidden.userId, userId))
      .all()
      .map((h) => h.swapId)
  );

  const shiftIds = rows.flatMap(({ swap }) =>
    [swap.offeredShiftId, swap.requestedShiftId, swap.acceptedShiftId].filter((id): id is string => Boolean(id))
  );
  const userIds = rows.flatMap(({ swap }) =>
    [swap.offeredByUserId, swap.targetUserId, swap.acceptedByUserId].filter((id): id is string => Boolean(id))
  );
  const duties = dutyInfos([...new Set(shiftIds)]);
  const users = people([...new Set(userIds)]);
  const person = (id: string | null) => (id ? (users.get(id) ?? { id, name: null }) : null);

  const board: Omit<Board, "calendars"> = { forMe: [], mine: [], hidden: [] };
  for (const { swap, calendarName } of rows) {
    const offered = duties.get(swap.offeredShiftId);
    if (!offered) continue; // shift is no duty anymore
    const entry: BoardEntry = {
      id: swap.id,
      type: swap.type,
      status: swap.status,
      calendarName,
      offered,
      requested: swap.requestedShiftId ? (duties.get(swap.requestedShiftId) ?? null) : null,
      accepted: swap.acceptedShiftId ? (duties.get(swap.acceptedShiftId) ?? null) : null,
      offeredBy: person(swap.offeredByUserId)!,
      target: person(swap.targetUserId),
      acceptedBy: person(swap.acceptedByUserId),
      note: swap.note,
      createdAt: swap.createdAt.toISOString(),
      resolvedAt: swap.resolvedAt?.toISOString() ?? null,
    };

    if (swap.offeredByUserId === userId) {
      const recent = swap.status === "open" || (swap.resolvedAt && now.getTime() - swap.resolvedAt.getTime() < HISTORY_MS);
      if (recent) board.mine.push(entry);
    } else if (swap.status === "open" && (!swap.targetUserId || swap.targetUserId === userId)) {
      if (!swap.targetUserId && hiddenIds.has(swap.id)) {
        if (includeHidden) board.hidden.push(entry);
      } else {
        board.forMe.push(entry);
      }
    }
  }
  const byDate = (a: BoardEntry, b: BoardEntry) => a.offered.date.localeCompare(b.offered.date);
  board.forMe.sort(byDate);
  board.hidden.sort(byDate);
  board.mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return board;
}

export function listDuties(calendarId: string, userId: string, now: Date): DutyListEntry[] {
  expireDue(now);
  const rows = db
    .select(dutyColumns)
    .from(rotationDuties)
    .innerJoin(shifts, eq(shifts.id, rotationDuties.shiftId))
    .where(eq(shifts.calendarId, calendarId))
    .all()
    .filter((d) => !hasStarted(d.date, d.startTime, now))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  if (rows.length === 0) return [];

  const shiftIds = rows.map((r) => r.shiftId);
  const signups = db
    .select({ shiftId: shiftSignups.shiftId, id: user.id, name: user.name })
    .from(shiftSignups)
    .innerJoin(user, eq(user.id, shiftSignups.userId))
    .where(inArray(shiftSignups.shiftId, shiftIds))
    .all();
  const myOpen = new Map(
    db
      .select({ id: shiftSwaps.id, shiftId: shiftSwaps.offeredShiftId })
      .from(shiftSwaps)
      .where(and(eq(shiftSwaps.status, "open"), eq(shiftSwaps.offeredByUserId, userId), inArray(shiftSwaps.offeredShiftId, shiftIds)))
      .all()
      .map((s) => [s.shiftId, s.id])
  );
  return rows.map((duty) => ({
    ...duty,
    holders: signups.filter((s) => s.shiftId === duty.shiftId).map(({ id, name }) => ({ id, name })),
    myOpenSwapId: myOpen.get(duty.shiftId) ?? null,
  }));
}

export function calendarState(calendarId: string, now: Date): CalendarSwapState {
  expireDue(now);
  const dutyShiftIds = db
    .select({ shiftId: rotationDuties.shiftId })
    .from(rotationDuties)
    .innerJoin(shifts, eq(shifts.id, rotationDuties.shiftId))
    .where(eq(shifts.calendarId, calendarId))
    .all()
    .map((d) => d.shiftId);
  const openOfferShiftIds = db
    .selectDistinct({ shiftId: shiftSwaps.offeredShiftId })
    .from(shiftSwaps)
    .innerJoin(shifts, eq(shifts.id, shiftSwaps.offeredShiftId))
    .where(and(eq(shiftSwaps.status, "open"), eq(shifts.calendarId, calendarId)))
    .all()
    .map((s) => s.shiftId);
  return { dutyShiftIds, openOfferShiftIds };
}
