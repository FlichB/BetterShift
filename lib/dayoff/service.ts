// [fork] Dienstfrei service (design 4). Every write runs inside the caller's synchronous
// better-sqlite3 transaction; mails go through the outbox in the same transaction.
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { shiftSignups } from "@/lib/db/schema";
import { formatDateToLocal } from "@/lib/date-utils";
import { enqueueDayOff } from "@/lib/dayoff/enqueue";
import { isFrozen, makeIsOff, revalidate, transferStatus, type IsOff } from "@/lib/dayoff/rules";
import { dayOffProposals, dayOffs, type DayOff } from "@/lib/dayoff/schema";
import type { DropReason } from "@/lib/dayoff/types";
import { loadClosedSet, takenDates, type Tx } from "@/lib/dayoff/workdays";
import { addDays } from "@/lib/rotation/dates";
import { rotationDuties, rotations, type Rotation } from "@/lib/rotation/schema";

export type { Reader, Tx } from "@/lib/dayoff/workdays";

export interface ReconcileEvent {
  dayOffId: string;
  kind: "reset" | "dropped";
  reason?: DropReason;
}

export interface ReconcileResult {
  created: number;
  transferred: number;
  dropped: number;
  reset: number;
  /** Audit events, logged by the caller outside the transaction. */
  events: ReconcileEvent[];
}

/** Window of Schließtage loaded around today; wide enough for every revalidated row. */
const CLOSED_FROM_DAYS = -31;
const CLOSED_TO_DAYS = 400;
/** Duties older than this are no longer compared with their holders. */
const DUTY_LOOKBACK_DAYS = -31;

function closedSetFor(tx: Tx, rotation: Rotation, today: string): Set<string> {
  return loadClosedSet(tx, rotation, addDays(today, CLOSED_FROM_DAYS), addDays(today, CLOSED_TO_DAYS));
}

/** Sets open proposals of a Dienstfrei to void (optionally only those matching `which`); no mail. */
function voidOpenProposals(tx: Tx, dayOffId: string, now: Date, which?: (date: string) => boolean): void {
  const open = tx
    .select({ id: dayOffProposals.id, date: dayOffProposals.date })
    .from(dayOffProposals)
    .where(and(eq(dayOffProposals.dayOffId, dayOffId), eq(dayOffProposals.status, "open")))
    .all()
    .filter((p) => !which || which(p.date));
  if (open.length === 0) return;
  tx.update(dayOffProposals)
    .set({ status: "void", resolvedAt: now })
    .where(inArray(dayOffProposals.id, open.map((p) => p.id)))
    .run();
}

function dropRow(tx: Tx, row: DayOff, reason: DropReason, now: Date, result: ReconcileResult): void {
  tx.update(dayOffs).set({ status: "dropped", dropReason: reason, date: null, updatedAt: now }).where(eq(dayOffs.id, row.id)).run();
  voidOpenProposals(tx, row.id, now);
  enqueueDayOff(tx, "day_off_dropped", row.id, "holder", null, now);
  result.dropped++;
  result.events.push({ dayOffId: row.id, kind: "dropped", reason });
}

/**
 * Gives a Dienstfrei to the new holder of its Platz (D14): standard/moved → standard,
 * locked/agreed → locked (without a date). A standard row keeps its old standard date
 * as a placeholder until the next revalidation recomputes it for the new holder.
 * Open proposals are voided; a locked result mails the new holder.
 */
function handOver(tx: Tx, row: DayOff, newUserId: string, actorId: string | null, now: Date): DayOff {
  const status = transferStatus(row.status);
  if (!status) return row;
  const locked = status === "locked";
  const updated = tx
    .update(dayOffs)
    .set({
      userId: newUserId,
      status,
      date: locked ? null : row.standardDate,
      agreedByUserId: null,
      // A lock stays with the Platz, including who set it and why.
      lockedByUserId: locked ? row.lockedByUserId : null,
      lockNote: locked ? row.lockNote : null,
      updatedAt: now,
    })
    .where(eq(dayOffs.id, row.id))
    .returning()
    .get();
  voidOpenProposals(tx, row.id, now);
  if (locked) enqueueDayOff(tx, "day_off_locked", row.id, "holder", actorId, now);
  return updated;
}

/**
 * Re-checks one row against the Arbeitstage (SPEC 12.38) and writes back any change.
 * `extraTaken` holds dates assigned to the same user earlier in the same pass.
 */
function revalidateOne(tx: Tx, row: DayOff, closed: ReadonlySet<string>, extraTaken: Iterable<string>, today: string, now: Date): { date: string | null; notify: "reset" | null } {
  const taken = takenDates(tx, row.userId, row.id);
  for (const date of extraTaken) taken.add(date);
  const isOff: IsOff = makeIsOff(closed, taken);
  const next = revalidate(row, isOff, today);
  if (next.status !== row.status || next.date !== row.date || next.standardDate !== row.standardDate) {
    tx.update(dayOffs)
      .set({
        status: next.status,
        date: next.date,
        standardDate: next.standardDate,
        // agreed → locked: the agreement no longer holds
        ...(row.status === "agreed" && next.status === "locked" ? { agreedByUserId: null } : {}),
        updatedAt: now,
      })
      .where(eq(dayOffs.id, row.id))
      .run();
  }
  // Proposals on begun dates or on days that are no longer Arbeitstage cannot be accepted anymore.
  voidOpenProposals(tx, row.id, now, (date) => date <= today || isOff(date));
  return { date: next.date, notify: next.notify };
}

/** Revalidates a single Dienstfrei (e.g. after a transfer). Enqueues the reset mail; returns whether it was reset. */
export function revalidateRow(tx: Tx, rowId: string, now: Date): "reset" | null {
  const row = tx.select().from(dayOffs).where(eq(dayOffs.id, rowId)).get();
  if (!row) return null;
  const today = formatDateToLocal(now);
  if (isFrozen(row, today)) return null;
  const rotation = tx.select().from(rotations).where(eq(rotations.id, row.rotationId)).get();
  if (!rotation) return null;
  const { notify } = revalidateOne(tx, row, closedSetFor(tx, rotation, today), [], today, now);
  if (notify === "reset") enqueueDayOff(tx, "day_off_reset", row.id, "holder", null, now);
  return notify;
}

/**
 * Brings the Dienstfreie of one rotation in line with its current Plätze and Schließtage (D15–D17).
 * Rows that have begun (or are dropped) are never touched.
 */
export function reconcileRotation(tx: Tx, rotationId: string, now: Date): ReconcileResult {
  const result: ReconcileResult = { created: 0, transferred: 0, dropped: 0, reset: 0, events: [] };

  // 1. Load the rotation; a missing one has nothing to reconcile.
  const rotation = tx.select().from(rotations).where(eq(rotations.id, rotationId)).get();
  if (!rotation) return result;
  const today = formatDateToLocal(now);

  // 2. Active rows: everything not frozen (not dropped, not begun; locked rows are always active).
  const allRows = tx.select().from(dayOffs).where(eq(dayOffs.rotationId, rotationId)).all();
  const active = allRows.filter((r) => !isFrozen(r, today));

  // 3. Switched off: drop every active row and stop.
  if (!rotation.dayOffEnabled) {
    for (const row of active) dropRow(tx, row, "disabled", now, result);
    return result;
  }

  // 4. Rows whose duty was deleted (shift_id set null) are dropped.
  for (const row of active) {
    if (row.shiftId === null) dropRow(tx, row, "noDuty", now, result);
  }

  // 5. Duties of the rotation from a month back on, with their holders.
  const duties = tx
    .select({ shiftId: rotationDuties.shiftId, date: rotationDuties.date })
    .from(rotationDuties)
    .where(
      and(
        eq(rotationDuties.rotationId, rotationId),
        eq(rotationDuties.kind, "duty"),
        gte(rotationDuties.date, addDays(today, DUTY_LOOKBACK_DAYS))
      )
    )
    .all();
  const holdersByShift = new Map<string, string[]>();
  if (duties.length > 0) {
    const signups = tx
      .select({ shiftId: shiftSignups.shiftId, userId: shiftSignups.userId })
      .from(shiftSignups)
      .where(inArray(shiftSignups.shiftId, duties.map((d) => d.shiftId)))
      .all();
    for (const s of signups) holdersByShift.set(s.shiftId, [...(holdersByShift.get(s.shiftId) ?? []), s.userId]);
  }

  // 6. Per duty: pair orphaned rows with new holders, drop the rest, create missing rows.
  const created = new Set<string>();
  for (const duty of duties) {
    const holders = new Set(holdersByShift.get(duty.shiftId) ?? []);
    // Every non-dropped row counts as "has a Dienstfrei", including begun ones, so a holder never gets a second row.
    const rowsOfDuty = allRows.filter((r) => r.shiftId === duty.shiftId && r.status !== "dropped");
    const withRow = new Set(rowsOfDuty.map((r) => r.userId));
    // Only active rows can change hands; ordered by creation for a stable pairing.
    const orphans = active
      .filter((r) => r.shiftId === duty.shiftId && !holders.has(r.userId))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const newcomers = [...holders].filter((u) => !withRow.has(u)).sort();

    while (orphans.length > 0 && newcomers.length > 0) {
      handOver(tx, orphans.shift()!, newcomers.shift()!, null, now);
      result.transferred++;
    }
    for (const orphan of orphans) dropRow(tx, orphan, "seatRemoved", now, result);
    // A duty in the past gets no new Dienstfrei.
    if (duty.date < today) continue;
    for (const userId of newcomers) {
      // The date is assigned in step 7.
      const row = tx
        .insert(dayOffs)
        .values({ rotationId, shiftId: duty.shiftId, dutyDate: duty.date, userId, status: "standard", createdAt: now, updatedAt: now })
        .returning({ id: dayOffs.id })
        .get();
      created.add(row.id);
      result.created++;
    }
  }

  // 7. Revalidate every non-frozen row against the current Arbeitstage, per user in duty order,
  //    so earlier duties pick their day first. Dates assigned in this pass count as taken.
  const closed = closedSetFor(tx, rotation, today);
  const rows = tx
    .select()
    .from(dayOffs)
    .where(eq(dayOffs.rotationId, rotationId))
    .orderBy(asc(dayOffs.userId), asc(dayOffs.dutyDate), asc(dayOffs.id))
    .all()
    .filter((r) => !isFrozen(r, today));
  const assigned = new Map<string, Set<string>>();
  for (const row of rows) {
    const mine = assigned.get(row.userId) ?? new Set<string>();
    const { date, notify } = revalidateOne(tx, row, closed, mine, today, now);
    if (date) mine.add(date);
    assigned.set(row.userId, mine);
    // New rows only get their first date here; that is not a reset.
    if (notify === "reset" && !created.has(row.id)) {
      enqueueDayOff(tx, "day_off_reset", row.id, "holder", null, now);
      result.reset++;
      result.events.push({ dayOffId: row.id, kind: "reset" });
    }
  }

  // 8. Counts (and audit events) for the caller.
  return result;
}

export function reconcileAll(now: Date): void {
  for (const { id } of db.select({ id: rotations.id }).from(rotations).all()) {
    db.transaction((tx) => reconcileRotation(tx, id, now));
  }
}

export function reconcileForShift(shiftId: string, now: Date): void {
  const duty = db.select({ rotationId: rotationDuties.rotationId }).from(rotationDuties).where(eq(rotationDuties.shiftId, shiftId)).get();
  if (duty) db.transaction((tx) => reconcileRotation(tx, duty.rotationId, now));
}
