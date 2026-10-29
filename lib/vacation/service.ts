// [fork] Urlaub workflow (SPEC 12.43, design §4–5). Permission checks of the Verwaltung live in the routes.
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { formatDateToLocal } from "@/lib/date-utils";
import { blockingRanges } from "@/lib/vacation/dates";
import { enqueueVacation } from "@/lib/vacation/enqueue";
import { VacationServiceError } from "@/lib/vacation/errors";
import { isParticipant, managedUserIds } from "@/lib/vacation/permissions";
import { resolveAction, runWithReplan } from "@/lib/vacation/replan";
import { vacationChanges, vacations, type Vacation, type VacationChange } from "@/lib/vacation/schema";
import type { ChangeKind, VacationBoard, VacationView } from "@/lib/vacation/types";
import { checkCancel, checkChange, checkNewRange } from "@/lib/vacation/validate";

export { VacationServiceError };

type RangeBody = { startDate: string; endDate: string; note: string | null };
const fail = (code: ConstructorParameters<typeof VacationServiceError>[0]): never => {
  throw new VacationServiceError(code);
};
const today = (now: Date) => formatDateToLocal(now);
// The write callbacks of runWithReplan run after an await: the status checked up front may be stale by then.
const ensureChanged = (result: { changes: number }): void => {
  if (result.changes === 0) fail("wrongStatus");
};

function loadVacation(id: string): Vacation {
  return db.select().from(vacations).where(eq(vacations.id, id)).get() ?? fail("notFound");
}
function loadChange(id: string): VacationChange {
  return db.select().from(vacationChanges).where(eq(vacationChanges.id, id)).get() ?? fail("notFound");
}
function reload(id: string): Vacation {
  return loadVacation(id);
}

export async function requestVacation(userId: string, body: RangeBody, now: Date): Promise<Vacation> {
  if (!isParticipant(userId)) fail("notParticipant");
  const range = { from: body.startDate, to: body.endDate };
  const error = checkNewRange(range, today(now), blockingRanges(db, userId));
  if (error) fail(error);
  return db.transaction((tx) => {
    const row = tx
      .insert(vacations)
      .values({ userId, startDate: body.startDate, endDate: body.endDate, note: body.note, status: "pending", requestedBy: userId, createdAt: now, updatedAt: now })
      .returning()
      .get();
    enqueueVacation(tx, "vacation_requested", row.id, userId, now);
    return row;
  });
}

export async function withdrawVacation(id: string, actorId: string, now: Date): Promise<Vacation> {
  const v = loadVacation(id);
  if (v.requestedBy !== actorId || v.userId !== actorId) fail("forbidden");
  if (v.status !== "pending") fail("wrongStatus");
  db.update(vacations).set({ status: "withdrawn", updatedAt: now }).where(eq(vacations.id, id)).run();
  return reload(id);
}

export async function rejectVacation(id: string, actorId: string, note: string, now: Date): Promise<Vacation> {
  const v = loadVacation(id);
  if (v.status !== "pending") fail("wrongStatus");
  db.transaction((tx) => {
    tx.update(vacations).set({ status: "rejected", decidedBy: actorId, decidedAt: now, decisionNote: note, updatedAt: now }).where(eq(vacations.id, id)).run();
    enqueueVacation(tx, "vacation_rejected", id, actorId, now);
  });
  return reload(id);
}

export async function approveVacation(id: string, actorId: string, now: Date): Promise<Vacation> {
  const v = loadVacation(id);
  if (v.status !== "pending") fail("wrongStatus");
  // Re-check: another vacation may have been approved since the request.
  const error = checkNewRange({ from: v.startDate, to: v.endDate }, today(now), blockingRanges(db, v.userId, { vacationId: id }));
  if (error) fail(error);
  const { changedFrom } = resolveAction(db, { kind: "approve", vacationId: id }, today(now));
  await runWithReplan(v.userId, changedFrom, actorId, now, (tx) => {
    ensureChanged(tx.update(vacations).set({ status: "approved", decidedBy: actorId, decidedAt: now, updatedAt: now }).where(and(eq(vacations.id, id), eq(vacations.status, "pending"))).run());
    const late = checkNewRange({ from: v.startDate, to: v.endDate }, today(now), blockingRanges(tx, v.userId, { vacationId: id }));
    if (late) fail(late);
    enqueueVacation(tx, "vacation_approved", id, actorId, now);
  });
  return reload(id);
}

export async function enterVacation(userId: string, body: RangeBody, actorId: string, now: Date): Promise<Vacation> {
  if (!isParticipant(userId)) fail("notParticipant");
  const error = checkNewRange({ from: body.startDate, to: body.endDate }, today(now), blockingRanges(db, userId));
  if (error) fail(error);
  const { changedFrom } = resolveAction(db, { kind: "enter", userId, startDate: body.startDate, endDate: body.endDate }, today(now));
  const id = await runWithReplan(userId, changedFrom, actorId, now, (tx) => {
    const late = checkNewRange({ from: body.startDate, to: body.endDate }, today(now), blockingRanges(tx, userId));
    if (late) fail(late);
    const row = tx
      .insert(vacations)
      .values({
        userId,
        startDate: body.startDate,
        endDate: body.endDate,
        note: body.note,
        status: "approved",
        requestedBy: actorId,
        decidedBy: actorId,
        decidedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    enqueueVacation(tx, "vacation_entered", row.id, actorId, now);
    return row.id;
  });
  return reload(id);
}

export async function changeVacation(id: string, range: { startDate: string; endDate: string }, actorId: string, now: Date): Promise<Vacation> {
  const v = loadVacation(id);
  if (v.status !== "approved") fail("wrongStatus");
  const error = checkChange({ from: v.startDate, to: v.endDate }, { from: range.startDate, to: range.endDate }, today(now), blockingRanges(db, v.userId, { vacationId: id }));
  if (error) fail(error);
  const { changedFrom } = resolveAction(db, { kind: "change", vacationId: id, ...range }, today(now));
  await runWithReplan(v.userId, changedFrom, actorId, now, (tx) => {
    ensureChanged(tx.update(vacations).set({ startDate: range.startDate, endDate: range.endDate, updatedAt: now }).where(and(eq(vacations.id, id), eq(vacations.status, "approved"))).run());
    const late = checkChange({ from: v.startDate, to: v.endDate }, { from: range.startDate, to: range.endDate }, today(now), blockingRanges(tx, v.userId, { vacationId: id }));
    if (late) fail(late);
    // A pending change request of the person is answered by the direct change.
    tx.update(vacationChanges).set({ status: "rejected", decidedBy: actorId, decidedAt: now, updatedAt: now }).where(and(eq(vacationChanges.vacationId, id), eq(vacationChanges.status, "pending"))).run();
    enqueueVacation(tx, "vacation_changed", id, actorId, now, { previousStart: v.startDate, previousEnd: v.endDate });
  });
  return reload(id);
}

export async function cancelVacation(id: string, actorId: string, now: Date): Promise<Vacation> {
  const v = loadVacation(id);
  if (v.status !== "approved") fail("wrongStatus");
  const error = checkCancel({ from: v.startDate, to: v.endDate }, today(now));
  if (error) fail(error);
  const { changedFrom } = resolveAction(db, { kind: "cancel", vacationId: id }, today(now));
  await runWithReplan(v.userId, changedFrom, actorId, now, (tx) => {
    ensureChanged(tx.update(vacations).set({ status: "cancelled", decidedBy: actorId, decidedAt: now, updatedAt: now }).where(and(eq(vacations.id, id), eq(vacations.status, "approved"))).run());
    tx.update(vacationChanges).set({ status: "rejected", decidedBy: actorId, decidedAt: now, updatedAt: now }).where(and(eq(vacationChanges.vacationId, id), eq(vacationChanges.status, "pending"))).run();
    enqueueVacation(tx, "vacation_cancelled", id, actorId, now);
  });
  return reload(id);
}

export async function requestChange(
  id: string,
  actorId: string,
  body: { kind: ChangeKind; startDate?: string; endDate?: string; note: string | null },
  now: Date
): Promise<VacationChange> {
  const v = loadVacation(id);
  if (v.userId !== actorId) fail("forbidden");
  if (v.status !== "approved") fail("wrongStatus");
  if (db.select().from(vacationChanges).where(and(eq(vacationChanges.vacationId, id), eq(vacationChanges.status, "pending"))).get()) fail("changePending");
  const current = { from: v.startDate, to: v.endDate };
  if (body.kind === "cancel") {
    const error = checkCancel(current, today(now));
    if (error) fail(error);
  } else {
    if (!body.startDate || !body.endDate) fail("invalid");
    const error = checkChange(current, { from: body.startDate!, to: body.endDate! }, today(now), blockingRanges(db, v.userId, { vacationId: id }));
    if (error) fail(error);
  }
  return db.transaction((tx) => {
    const row = tx
      .insert(vacationChanges)
      .values({
        vacationId: id,
        kind: body.kind,
        startDate: body.kind === "change" ? body.startDate! : null,
        endDate: body.kind === "change" ? body.endDate! : null,
        note: body.note,
        status: "pending",
        requestedBy: actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    enqueueVacation(tx, "vacation_change_requested", id, actorId, now, { changeId: row.id });
    return row;
  });
}

export async function approveChange(changeId: string, actorId: string, now: Date): Promise<VacationChange> {
  const c = loadChange(changeId);
  if (c.status !== "pending") fail("wrongStatus");
  const v = loadVacation(c.vacationId);
  if (v.status !== "approved") fail("wrongStatus");
  const current = { from: v.startDate, to: v.endDate };
  const error =
    c.kind === "cancel"
      ? checkCancel(current, today(now))
      : checkChange(current, { from: c.startDate!, to: c.endDate! }, today(now), blockingRanges(db, v.userId, { vacationId: v.id }));
  if (error) fail(error);
  const { changedFrom } = resolveAction(db, { kind: "approveChange", changeId }, today(now));
  await runWithReplan(v.userId, changedFrom, actorId, now, (tx) => {
    ensureChanged(tx.update(vacationChanges).set({ status: "approved", decidedBy: actorId, decidedAt: now, updatedAt: now }).where(and(eq(vacationChanges.id, changeId), eq(vacationChanges.status, "pending"))).run());
    const approvedOnly = and(eq(vacations.id, v.id), eq(vacations.status, "approved"));
    if (c.kind === "cancel") ensureChanged(tx.update(vacations).set({ status: "cancelled", updatedAt: now }).where(approvedOnly).run());
    else {
      ensureChanged(tx.update(vacations).set({ startDate: c.startDate!, endDate: c.endDate!, updatedAt: now }).where(approvedOnly).run());
      const late = checkChange({ from: v.startDate, to: v.endDate }, { from: c.startDate!, to: c.endDate! }, today(now), blockingRanges(tx, v.userId, { vacationId: v.id }));
      if (late) fail(late);
    }
    // An approved cancel request reads like a cancellation for the person.
    if (c.kind === "cancel") enqueueVacation(tx, "vacation_cancelled", v.id, actorId, now, { changeId });
    else enqueueVacation(tx, "vacation_change_approved", v.id, actorId, now, { changeId, previousStart: v.startDate, previousEnd: v.endDate });
  });
  return loadChange(changeId);
}

export async function rejectChange(changeId: string, actorId: string, note: string, now: Date): Promise<VacationChange> {
  const c = loadChange(changeId);
  if (c.status !== "pending") fail("wrongStatus");
  db.transaction((tx) => {
    tx.update(vacationChanges).set({ status: "rejected", decidedBy: actorId, decidedAt: now, decisionNote: note, updatedAt: now }).where(eq(vacationChanges.id, changeId)).run();
    enqueueVacation(tx, "vacation_change_rejected", c.vacationId, actorId, now, { changeId });
  });
  return loadChange(changeId);
}

export async function withdrawChange(changeId: string, actorId: string, now: Date): Promise<VacationChange> {
  const c = loadChange(changeId);
  if (c.requestedBy !== actorId) fail("forbidden");
  if (c.status !== "pending") fail("wrongStatus");
  db.update(vacationChanges).set({ status: "withdrawn", updatedAt: now }).where(eq(vacationChanges.id, changeId)).run();
  return loadChange(changeId);
}

function views(rows: Vacation[]): VacationView[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const pending = db.select().from(vacationChanges).where(and(inArray(vacationChanges.vacationId, ids), eq(vacationChanges.status, "pending"))).all();
  const people = new Map(db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(rows.map((r) => r.userId))])).all().map((u) => [u.id, u.name]));
  return rows.map((r) => {
    const c = pending.find((p) => p.vacationId === r.id);
    return {
      id: r.id,
      user: { id: r.userId, name: people.get(r.userId) ?? "" },
      startDate: r.startDate,
      endDate: r.endDate,
      note: r.note,
      status: r.status,
      decisionNote: r.decisionNote,
      direct: r.requestedBy !== r.userId,
      pendingChange: c ? { id: c.id, kind: c.kind, startDate: c.startDate, endDate: c.endDate, note: c.note, status: c.status, decisionNote: c.decisionNote } : null,
    };
  });
}

export async function listBoard(actorId: string, year: number, now: Date): Promise<VacationBoard> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const inYear = and(lte(vacations.startDate, yearEnd), gte(vacations.endDate, yearStart));
  const mine = db.select().from(vacations).where(and(eq(vacations.userId, actorId), inYear)).orderBy(asc(vacations.startDate)).all();
  const managed = [...(await managedUserIds(actorId))];
  const isManager = managed.length > 0;
  const team = isManager
    ? db.select().from(vacations).where(and(inArray(vacations.userId, managed), inArray(vacations.status, ["pending", "approved"]), inYear)).orderBy(asc(vacations.startDate)).all()
    : [];
  const withChange = new Set(
    isManager ? db.select({ id: vacationChanges.vacationId }).from(vacationChanges).where(eq(vacationChanges.status, "pending")).all().map((r) => r.id) : []
  );
  // Requests are not limited to the year: an open request must never hide behind the year switcher.
  const requests = isManager
    ? db
        .select()
        .from(vacations)
        .where(inArray(vacations.userId, managed))
        .orderBy(asc(vacations.startDate))
        .all()
        .filter((r) => r.status === "pending" || (r.status === "approved" && withChange.has(r.id)))
    : [];
  const people = isManager
    ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, managed)).orderBy(asc(user.name)).all()
    : [];
  void now; // part of the service signature; listing does not depend on the clock
  return { mine: views(mine), team: views(team), requests: views(requests), people, isManager, canRequest: isParticipant(actorId) };
}
