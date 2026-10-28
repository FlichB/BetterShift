// [fork] Dienstfrei service (design 4). Every write runs inside the caller's synchronous
// better-sqlite3 transaction; mails go through the outbox in the same transaction.
import { and, asc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars, shiftSignups, shifts, user } from "@/lib/db/schema";
import { formatDateToLocal } from "@/lib/date-utils";
import { logReconcileEventsLater } from "@/lib/dayoff/audit";
import { enqueueDayOff } from "@/lib/dayoff/enqueue";
import {
  checkAcceptDate,
  checkCounter,
  checkLock,
  checkMove,
  checkProposeDates,
  isFrozen,
  makeIsOff,
  revalidate,
  transferStatus,
  weekOf,
  type IsOff,
  type RuleResult,
} from "@/lib/dayoff/rules";
import { dayOffProposals, dayOffs, type DayOff, type DayOffProposal } from "@/lib/dayoff/schema";
import { REMINDER_AFTER_DAYS, type DayOffBoard, type DayOffErrorCode, type DayOffView, type DropReason, type MoveOption } from "@/lib/dayoff/types";
import { counterWindowEnd, type SlotMove } from "@/lib/swap/rules";
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
 * Open proposals are voided; a locked result mails the new holder. The mail has no actor:
 * the new holder may be the one who triggered the swap and must still get it.
 */
function handOver(tx: Tx, row: DayOff, newUserId: string, now: Date): DayOff {
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
  if (locked) enqueueDayOff(tx, "day_off_locked", row.id, "holder", null, now);
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

/** Hands the Dienstfrei of a moved Platz to its new holder and revalidates it for them (SPEC 12.38). */
export function transferDayOff(tx: Tx, move: SlotMove, now: Date): void {
  const row = tx
    .select()
    .from(dayOffs)
    .where(and(eq(dayOffs.shiftId, move.shiftId), eq(dayOffs.userId, move.fromUserId), ne(dayOffs.status, "dropped")))
    .get();
  if (!row || isFrozen(row, formatDateToLocal(now))) return;
  handOver(tx, row, move.toUserId, now);
  revalidateRow(tx, row.id, now);
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
      handOver(tx, orphans.shift()!, newcomers.shift()!, now);
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

/**
 * Reconciles every rotation, one transaction each, and logs the audit events afterwards.
 * A failing rotation rolls back alone and is logged; the others still run.
 */
export function reconcileAll(now: Date): void {
  const events: ReconcileEvent[] = [];
  for (const { id } of db.select({ id: rotations.id }).from(rotations).all()) {
    try {
      events.push(...db.transaction((tx) => reconcileRotation(tx, id, now)).events);
    } catch (error) {
      console.error("[dayoff] reconcile failed", id, error);
    }
  }
  logReconcileEventsLater(events);
}

/**
 * Open holder proposals older than REMINDER_AFTER_DAYS that were not reminded yet: one
 * manager reminder per Dienstfrei, then every proposal of the group is marked reminded.
 */
export function sendReminders(now: Date): number {
  const cutoff = new Date(now.getTime() - REMINDER_AFTER_DAYS * 86_400_000);
  return db.transaction((tx) => {
    const due = tx
      .select()
      .from(dayOffProposals)
      .where(
        and(
          eq(dayOffProposals.side, "holder"),
          eq(dayOffProposals.status, "open"),
          isNull(dayOffProposals.remindedAt),
          lte(dayOffProposals.createdAt, cutoff)
        )
      )
      .orderBy(asc(dayOffProposals.createdAt))
      .all();
    const groups = new Map<string, string[]>();
    for (const p of due) groups.set(p.dayOffId, [...(groups.get(p.dayOffId) ?? []), p.id]);
    for (const [dayOffId, ids] of groups) {
      enqueueDayOff(tx, "day_off_reminder", dayOffId, "managers", null, now, ids[0]);
      tx.update(dayOffProposals).set({ remindedAt: now }).where(inArray(dayOffProposals.id, ids)).run();
    }
    return groups.size;
  });
}

/** Reconciles the rotation owning a duty shift (after a signup change) and logs the audit events. */
export function reconcileForShift(shiftId: string, now: Date): void {
  const duty = db.select({ rotationId: rotationDuties.rotationId }).from(rotationDuties).where(eq(rotationDuties.shiftId, shiftId)).get();
  if (!duty) return;
  logReconcileEventsLater(db.transaction((tx) => reconcileRotation(tx, duty.rotationId, now)).events);
}

// ---------------------------------------------------------------------------
// User actions (SPEC 12.36–12.37). The routes check everything beyond
// "is the holder" and "is a manager" (passed in as actorIsManager).
// ---------------------------------------------------------------------------

export class DayOffServiceError extends Error {
  constructor(public readonly code: DayOffErrorCode) {
    super(code);
    this.name = "DayOffServiceError";
  }
}

function unwrap<T>(result: RuleResult<T>): T {
  if (!result.ok) throw new DayOffServiceError(result.code);
  return result.value;
}

function loadRow(tx: Tx, id: string): DayOff {
  const row = tx.select().from(dayOffs).where(eq(dayOffs.id, id)).get();
  if (!row) throw new DayOffServiceError("notFound");
  return row;
}

function loadProposal(tx: Tx, id: string): DayOffProposal {
  const proposal = tx.select().from(dayOffProposals).where(eq(dayOffProposals.id, id)).get();
  if (!proposal) throw new DayOffServiceError("notFound");
  return proposal;
}

/** The holder's non-Arbeitstage for this row: Schließtage of its rotation plus their other Dienstfreie. */
function isOffFor(tx: Tx, row: DayOff, today: string): IsOff {
  const rotation = tx.select().from(rotations).where(eq(rotations.id, row.rotationId)).get();
  if (!rotation) throw new DayOffServiceError("notFound");
  return makeIsOff(closedSetFor(tx, rotation, today), takenDates(tx, row.userId, row.id));
}

function openProposalDates(tx: Tx, dayOffId: string): string[] {
  return tx
    .select({ date: dayOffProposals.date })
    .from(dayOffProposals)
    .where(and(eq(dayOffProposals.dayOffId, dayOffId), eq(dayOffProposals.status, "open")))
    .all()
    .map((p) => p.date);
}

/** Holder moves a standard/moved Dienstfrei within its week. */
export function moveDayOff(id: string, date: string, actorId: string, now: Date): DayOff {
  return db.transaction((tx) => {
    const row = loadRow(tx, id);
    if (row.userId !== actorId) throw new DayOffServiceError("notHolder");
    const today = formatDateToLocal(now);
    const next = unwrap(checkMove(row, date, isOffFor(tx, row, today), today));
    return tx.update(dayOffs).set({ status: next.status, date: next.date, updatedAt: now }).where(eq(dayOffs.id, id)).returning().get();
  });
}

/** Manager locks a Dienstfrei: no date until one is agreed. Open proposals are voided. */
export function lockDayOff(id: string, note: string | null, actorId: string, now: Date): DayOff {
  return db.transaction((tx) => {
    const row = loadRow(tx, id);
    const today = formatDateToLocal(now);
    unwrap(checkLock(row, today));
    const updated = tx
      .update(dayOffs)
      .set({ status: "locked", date: null, lockedByUserId: actorId, lockNote: note?.trim() || null, agreedByUserId: null, updatedAt: now })
      .where(eq(dayOffs.id, id))
      .returning()
      .get();
    voidOpenProposals(tx, id, now);
    enqueueDayOff(tx, "day_off_locked", id, "holder", actorId, now);
    return updated;
  });
}

/** Holder proposes dates for a locked Dienstfrei (or other dates for an agreed one). One mail per call. */
export function proposeDates(id: string, dates: string[], actorId: string, now: Date): DayOffProposal[] {
  return db.transaction((tx) => {
    const row = loadRow(tx, id);
    if (row.userId !== actorId) throw new DayOffServiceError("notHolder");
    const today = formatDateToLocal(now);
    const valid = unwrap(checkProposeDates(row, dates, openProposalDates(tx, id), isOffFor(tx, row, today), today));
    const created = tx
      .insert(dayOffProposals)
      .values(valid.map((date) => ({ dayOffId: id, date, side: "holder" as const, proposedByUserId: actorId, status: "open" as const, createdAt: now })))
      .returning()
      .all();
    enqueueDayOff(tx, "day_off_proposed", id, "managers", actorId, now, created[0].id);
    return created;
  });
}

/** Manager proposes a date to the holder. */
export function counterPropose(id: string, date: string, actorId: string, now: Date): DayOffProposal {
  return db.transaction((tx) => {
    const row = loadRow(tx, id);
    const today = formatDateToLocal(now);
    const valid = unwrap(checkCounter(row, date, openProposalDates(tx, id), isOffFor(tx, row, today), today));
    const created = tx
      .insert(dayOffProposals)
      .values({ dayOffId: id, date: valid, side: "manager", proposedByUserId: actorId, status: "open", createdAt: now })
      .returning()
      .get();
    enqueueDayOff(tx, "day_off_countered", id, "holder", actorId, now, created.id);
    return created;
  });
}

/** A holder proposal is answered by a manager, a manager proposal by the holder. */
function assertOtherSide(proposal: DayOffProposal, row: DayOff, actorId: string, actorIsManager: boolean): void {
  const allowed = proposal.side === "holder" ? actorIsManager : row.userId === actorId;
  if (!allowed) throw new DayOffServiceError("forbidden");
}

const otherSide = (proposal: DayOffProposal) => (proposal.side === "holder" ? "managers" : "holder");

export function acceptProposal(proposalId: string, actorId: string, actorIsManager: boolean, now: Date): DayOff {
  return db.transaction((tx) => {
    const proposal = loadProposal(tx, proposalId);
    if (proposal.status !== "open") throw new DayOffServiceError("proposalNotOpen");
    const row = loadRow(tx, proposal.dayOffId);
    assertOtherSide(proposal, row, actorId, actorIsManager);
    const today = formatDateToLocal(now);
    const date = unwrap(checkAcceptDate(row, proposal.date, isOffFor(tx, row, today), today));
    const updated = tx
      .update(dayOffs)
      .set({ status: "agreed", date, agreedByUserId: actorId, updatedAt: now })
      .where(eq(dayOffs.id, row.id))
      .returning()
      .get();
    tx.update(dayOffProposals)
      .set({ status: "accepted", resolvedByUserId: actorId, resolvedAt: now })
      .where(eq(dayOffProposals.id, proposalId))
      .run();
    voidOpenProposals(tx, row.id, now);
    enqueueDayOff(tx, "day_off_accepted", row.id, otherSide(proposal), actorId, now, proposalId);
    return updated;
  });
}

export function declineProposal(proposalId: string, reason: string | null, actorId: string, actorIsManager: boolean, now: Date): DayOffProposal {
  return db.transaction((tx) => {
    const proposal = loadProposal(tx, proposalId);
    if (proposal.status !== "open") throw new DayOffServiceError("proposalNotOpen");
    const row = loadRow(tx, proposal.dayOffId);
    assertOtherSide(proposal, row, actorId, actorIsManager);
    const declineReason = reason?.trim() || null;
    // A manager turning down the holder's wish has to say why.
    if (proposal.side === "holder" && !declineReason) throw new DayOffServiceError("reasonRequired");
    const updated = tx
      .update(dayOffProposals)
      .set({ status: "declined", declineReason, resolvedByUserId: actorId, resolvedAt: now })
      .where(eq(dayOffProposals.id, proposalId))
      .returning()
      .get();
    enqueueDayOff(tx, "day_off_declined", row.id, otherSide(proposal), actorId, now, proposalId);
    return updated;
  });
}

/** Days of the standard week the holder may move to, with how many colleagues of the calendar are off then. */
export function moveOptions(id: string, now: Date): MoveOption[] {
  return db.transaction((tx) => {
    const row = loadRow(tx, id);
    // Only a standard or moved Dienstfrei can be moved; locked/agreed ones go through proposals.
    if ((row.status !== "standard" && row.status !== "moved") || !row.standardDate) return [];
    const today = formatDateToLocal(now);
    const isOff = isOffFor(tx, row, today);
    const dates = weekOf(row.standardDate).filter((date) => date === row.date || checkMove(row, date, isOff, today).ok);
    if (dates.length === 0) return [];
    const rotation = tx.select({ calendarId: rotations.calendarId }).from(rotations).where(eq(rotations.id, row.rotationId)).get();
    const others = tx
      .select({ id: dayOffs.id, date: dayOffs.date })
      .from(dayOffs)
      .innerJoin(rotations, eq(rotations.id, dayOffs.rotationId))
      .where(and(eq(rotations.calendarId, rotation?.calendarId ?? ""), inArray(dayOffs.date, dates), ne(dayOffs.status, "dropped")))
      .all()
      .filter((o) => o.id !== row.id);
    return dates.map((date) => ({
      date,
      othersOff: others.filter((o) => o.date === date).length,
      isCurrent: date === row.date,
      isStandard: date === row.standardDate,
    }));
  });
}

/** How long begun and dropped Dienstfreie stay on the holder's board. */
const BOARD_HISTORY_DAYS = 30;

function toViews(rows: DayOff[]): DayOffView[] {
  if (rows.length === 0) return [];
  const rotationRows = db
    .select({ id: rotations.id, calendarId: calendars.id, calendarName: calendars.name })
    .from(rotations)
    .innerJoin(calendars, eq(calendars.id, rotations.calendarId))
    .where(inArray(rotations.id, [...new Set(rows.map((r) => r.rotationId))]))
    .all();
  const rotationById = new Map(rotationRows.map((r) => [r.id, r]));
  const shiftIds = [...new Set(rows.map((r) => r.shiftId).filter((id): id is string => !!id))];
  const titles = new Map(
    shiftIds.length > 0
      ? db.select({ id: shifts.id, title: shifts.title }).from(shifts).where(inArray(shifts.id, shiftIds)).all().map((s) => [s.id, s.title])
      : []
  );
  const names = new Map(
    db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, [...new Set(rows.map((r) => r.userId))]))
      .all()
      .map((u) => [u.id, u.name])
  );
  const proposals = db
    .select()
    .from(dayOffProposals)
    .where(inArray(dayOffProposals.dayOffId, rows.map((r) => r.id)))
    .orderBy(asc(dayOffProposals.createdAt), asc(dayOffProposals.date))
    .all();

  return rows
    .map((row): DayOffView => {
      const rotation = rotationById.get(row.rotationId);
      return {
        id: row.id,
        calendarId: rotation?.calendarId ?? "",
        calendarName: rotation?.calendarName ?? "",
        rotationId: row.rotationId,
        dutyDate: row.dutyDate,
        dutyTitle: (row.shiftId && titles.get(row.shiftId)) || "",
        holder: { id: row.userId, name: names.get(row.userId) ?? "" },
        status: row.status,
        date: row.date,
        standardDate: row.standardDate,
        lockNote: row.lockNote,
        dropReason: row.dropReason,
        windowEnd: counterWindowEnd(row.dutyDate),
        proposals: proposals
          .filter((p) => p.dayOffId === row.id)
          .map((p) => ({ id: p.id, date: p.date, side: p.side, status: p.status, declineReason: p.declineReason, createdAt: p.createdAt.toISOString() })),
        canMove: false,
      };
    })
    .sort((a, b) => a.dutyDate.localeCompare(b.dutyDate) || a.holder.name.localeCompare(b.holder.name) || a.id.localeCompare(b.id));
}

/**
 * The Dienstfrei board: the user's own rows (active ones, plus begun and dropped ones for a month)
 * and every active row of the calendars they manage (locked rows are never frozen, so they are in).
 */
export function listDayOffBoard(userId: string, manageCalendarIds: string[], now: Date): DayOffBoard {
  const today = formatDateToLocal(now);
  const historyFrom = addDays(today, -BOARD_HISTORY_DAYS);
  const historySince = new Date(now.getTime() - BOARD_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const mine = db
    .select()
    .from(dayOffs)
    .where(eq(dayOffs.userId, userId))
    .all()
    .filter((row) => {
      if (row.status === "dropped") return row.updatedAt >= historySince;
      if (!isFrozen(row, today)) return true;
      return !!row.date && row.date >= historyFrom;
    });
  const manage =
    manageCalendarIds.length === 0
      ? []
      : db
          .select({ row: dayOffs })
          .from(dayOffs)
          .innerJoin(rotations, eq(rotations.id, dayOffs.rotationId))
          .where(and(inArray(rotations.calendarId, manageCalendarIds), ne(dayOffs.status, "dropped")))
          .all()
          .map((r) => r.row)
          .filter((row) => !isFrozen(row, today));
  return { mine: toViews(mine), manage: toViews(manage), manageCalendarIds };
}
