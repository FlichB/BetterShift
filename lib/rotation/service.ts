import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars, shiftPresets, shiftSignups, shifts } from "@/lib/db/schema";
import type { YearDeltaTable } from "@/lib/rotation/yearly"; // [fork] Jahresausgleich
import { formatDateToLocal, parseLocalDate } from "@/lib/date-utils";
import { replaceShiftSegments, withPresetSegments } from "@/lib/shift-time-ranges";
import {
  readPresetCustomFieldValues,
  type CustomFieldValueRow,
  replaceShiftCustomFieldValues,
} from "@/lib/shift-custom-fields";
import type { TimeRange } from "@/lib/time-ranges";
import { reconcileRotation, type ReconcileEvent } from "@/lib/dayoff/service"; // [fork] Dienstfrei
import { logReconcileEventsLater } from "@/lib/dayoff/audit"; // [fork] Dienstfrei
import { CLOSURE_FIELDS, resolveClosedDates } from "@/lib/rotation/closures";
import { hasStarted } from "@/lib/rotation/dates";
import { generateDays, suggestStartOffset, yearSummary } from "@/lib/rotation/generate";
import { loadHolidays } from "@/lib/rotation/holidays";
import {
  planClosures,
  planGeneration,
  type DutyTemplate,
  type ExistingClosure,
  type ExistingDuty,
  type GenerationPlan,
} from "@/lib/rotation/plan";
import {
  rotationDuties,
  rotationMembers,
  rotationSlotLocks,
  rotationYearDeltas,
  rotations,
  type Rotation,
} from "@/lib/rotation/schema";
import type { ClosedDate, RotationRule } from "@/lib/rotation/types";
import type { RotationInput } from "@/lib/rotation/validate";
import { approvedRanges } from "@/lib/vacation/dates"; // [fork] Urlaub
import type { DateRange } from "@/lib/vacation/types"; // [fork] Urlaub

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface RotationDetail extends Rotation {
  memberIds: string[];
  /** [fork] Teilnehmer without Dienstfrei (SPEC 12.40). */
  dayOffExcludedIds: string[];
  /** [fork] Jahresausgleich: userId → since when a Teilnehmer (SPEC 12.41). */
  memberSince: Record<string, string>;
}

/** [fork] Urlaub: a hypothetical set of approved ranges for one user, used by previews. */
export interface VacationOverride {
  userId: string;
  ranges: DateRange[];
}

/** [fork] Urlaub: approved vacations of the Teilnehmer, with an optional override for one user. */
function loadAbsences(reader: Tx | typeof db, memberIds: string[], override?: VacationOverride): Map<string, DateRange[]> {
  const ranges = approvedRanges(reader, memberIds);
  if (override && memberIds.includes(override.userId)) ranges.set(override.userId, override.ranges);
  return ranges;
}

export type RotationError = "notFound" | "presetMissing" | "presetArchived" | "signupsDisabled" | "notMember";

export class RotationServiceError extends Error {
  constructor(public readonly code: RotationError) {
    super(code);
  }
}

export interface GenerationSummary {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  warnings: number;
}

/** What generation needs from outside a transaction; the preset fields as loadTemplate reads them. */
export interface PreparedGeneration {
  rotationId: string;
  presetId: string;
  template: DutyTemplate;
  segments: TimeRange[];
  customFieldValues: CustomFieldValueRow[];
}

function withMembers(tx: Tx | typeof db, rotation: Rotation): RotationDetail {
  const members = tx
    .select({ userId: rotationMembers.userId, dayOff: rotationMembers.dayOff, joinedOn: rotationMembers.joinedOn })
    .from(rotationMembers)
    .where(eq(rotationMembers.rotationId, rotation.id))
    .orderBy(asc(rotationMembers.position))
    .all();
  return {
    ...rotation,
    memberIds: members.map((m) => m.userId),
    dayOffExcludedIds: members.filter((m) => !m.dayOff).map((m) => m.userId), // [fork] Dienstfrei
    memberSince: Object.fromEntries(members.map((m) => [m.userId, m.joinedOn])), // [fork] Jahresausgleich
  };
}

function loadRotation(tx: Tx | typeof db, id: string): RotationDetail {
  const rotation = tx.select().from(rotations).where(eq(rotations.id, id)).get();
  if (!rotation) throw new RotationServiceError("notFound");
  return withMembers(tx, rotation);
}

/**
 * Schließeinträge this rotation already wrote up to today (a Schließeintrag has
 * begun at 00:00). They keep counting as Schließtage even after their Feiertag
 * left the Feiertagskalender (the sync only keeps a window around now) or the
 * Ausfalltag was removed, so the round count of future duties stays put.
 */
function begunClosures(reader: Tx | typeof db, r: RotationDetail, today: string): ClosedDate[] {
  return reader
    .select({ date: rotationDuties.date, title: shifts.title })
    .from(rotationDuties)
    .innerJoin(shifts, eq(shifts.id, rotationDuties.shiftId))
    .where(
      and(
        eq(rotationDuties.rotationId, r.id),
        eq(rotationDuties.kind, "closed"),
        gte(rotationDuties.date, r.startDate),
        lte(rotationDuties.date, today)
      )
    )
    .all()
    .map((row) => ({ date: row.date, reason: row.title, source: "holiday" }));
}

/**
 * [fork] Jahresausgleich: real holders per Diensttag for counting Plätze. Begun days and days with a
 * Gesperrter Platz are authoritative; other future seats are only plan, so the generator counts its own.
 */
function loadHeldDuties(reader: Tx | typeof db, rotationId: string, today: string): Record<string, string[]> {
  const rows = reader
    .select({ shiftId: rotationDuties.shiftId, date: rotationDuties.date, userId: shiftSignups.userId })
    .from(rotationDuties)
    .leftJoin(shiftSignups, eq(shiftSignups.shiftId, rotationDuties.shiftId))
    .where(and(eq(rotationDuties.rotationId, rotationId), eq(rotationDuties.kind, "duty")))
    .all();
  const lockedShifts = new Set(
    reader
      .select({ shiftId: rotationSlotLocks.shiftId })
      .from(rotationSlotLocks)
      .innerJoin(rotationDuties, eq(rotationDuties.shiftId, rotationSlotLocks.shiftId))
      .where(eq(rotationDuties.rotationId, rotationId))
      .all()
      .map((l) => l.shiftId)
  );
  const held: Record<string, string[]> = {};
  for (const row of rows) {
    if (row.date > today && !lockedShifts.has(row.shiftId)) continue;
    const list = (held[row.date] ??= []);
    if (row.userId) list.push(row.userId);
  }
  return held;
}

function loadDeltaOverrides(reader: Tx | typeof db, rotationId: string): Record<number, Record<string, number>> {
  const overrides: Record<number, Record<string, number>> = {};
  for (const row of reader.select().from(rotationYearDeltas).where(eq(rotationYearDeltas.rotationId, rotationId)).all()) {
    (overrides[row.year] ??= {})[row.userId] = row.delta;
  }
  return overrides;
}

function toRule(
  reader: Tx | typeof db,
  r: RotationDetail,
  to: string,
  now: Date,
  absences: Map<string, DateRange[]> // [fork] Urlaub
): RotationRule {
  // Seat rounds make a duty depend on the sizes of later duties in its round, so a Feiertag
  // after `to` can still matter. Closures after the last verstärkter Tag cannot change the
  // size sequence before it, so loading up to there keeps the plan independent of the window.
  // [fork] Jahresausgleich: a yearly round looks ahead to the end of its year, so a Feiertag up to
  // 31.12. of `to`'s year can change earlier rounds.
  const lookahead = r.yearlyFairness && `${to.slice(0, 4)}-12-31` > to ? `${to.slice(0, 4)}-12-31` : to;
  const holidaysTo = r.reinforcedDates.reduce((max, d) => (d.date > max ? d.date : max), lookahead);
  const holidays =
    r.holidayCalendarId && to >= r.startDate ? loadHolidays(reader, r.holidayCalendarId, r.startDate, holidaysTo) : [];
  const resolved = resolveClosedDates(r.skipDates, holidays, r.holidayOpenDates);
  // On begun days the written Schließeinträge are authoritative; Ausfalltage and the calendar decide the rest.
  const past = begunClosures(reader, r, formatDateToLocal(now));
  const pastDates = new Set(past.map((c) => c.date));
  const resolvedDates = new Set(resolved.closedDates.map((c) => c.date));
  const closedDates = [...resolved.closedDates, ...past.filter((c) => !resolvedDates.has(c.date))].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  const openHolidays = resolved.openHolidays.filter((h) => !pastDates.has(h.date));
  return {
    memberIds: r.memberIds,
    perShift: r.perShift,
    period: r.period,
    periodDays: r.periodDays,
    startDate: r.startDate,
    startOffset: r.startOffset,
    weekdays: r.weekdays,
    closedDates,
    openHolidays,
    reinforcedDates: r.reinforcedDates,
    // [fork] Jahresausgleich (SPEC 12.41)
    yearlyFairness: r.yearlyFairness,
    memberSince: r.memberSince,
    heldDuties: r.yearlyFairness ? loadHeldDuties(reader, r.id, formatDateToLocal(now)) : {},
    deltaOverrides: r.yearlyFairness ? loadDeltaOverrides(reader, r.id) : {},
    absences: [...absences].flatMap(([userId, list]) => list.map((range) => ({ userId, from: range.from, to: range.to }))), // [fork] Urlaub
  };
}

function writeMembers(tx: Tx, rotationId: string, input: RotationInput, joinedToday: string): void {
  const excluded = new Set(input.dayOffExcludedIds); // [fork] Dienstfrei
  // [fork] Jahresausgleich: staying Teilnehmer keep their joinedOn; new ones join joinedToday.
  const since = new Map(
    tx
      .select({ userId: rotationMembers.userId, joinedOn: rotationMembers.joinedOn })
      .from(rotationMembers)
      .where(eq(rotationMembers.rotationId, rotationId))
      .all()
      .map((m) => [m.userId, m.joinedOn])
  );
  tx.delete(rotationMembers).where(eq(rotationMembers.rotationId, rotationId)).run();
  tx.insert(rotationMembers)
    .values(
      input.memberIds.map((userId, position) => ({
        rotationId,
        userId,
        position,
        dayOff: !excluded.has(userId),
        joinedOn: since.get(userId) ?? joinedToday,
      }))
    )
    .run();
}

function configValues(input: RotationInput) {
  return {
    name: input.name,
    presetId: input.presetId,
    perShift: input.perShift,
    period: input.period,
    periodDays: input.periodDays,
    startDate: input.startDate,
    startOffset: input.startOffset,
    weekdays: input.weekdays,
    skipDates: input.skipDates,
    closedTitle: input.closedTitle,
    holidayCalendarId: input.holidayCalendarId,
    holidayOpenDates: input.holidayOpenDates,
    entryTitle: input.entryTitle,
    reinforcedDates: input.reinforcedDates,
    dayOffEnabled: input.dayOffEnabled, // [fork] Dienstfrei
    dayOffTitle: input.dayOffTitle, // [fork] Dienstfrei
    dayOffTiming: input.dayOffTiming, // [fork] Dienstfrei
    yearlyFairness: input.yearlyFairness, // [fork] Jahresausgleich
  };
}

export function listRotations(calendarId: string): RotationDetail[] {
  return db
    .select()
    .from(rotations)
    .where(eq(rotations.calendarId, calendarId))
    .orderBy(asc(rotations.name))
    .all()
    .map((r) => withMembers(db, r));
}

export function getRotation(id: string): RotationDetail | null {
  const rotation = db.select().from(rotations).where(eq(rotations.id, id)).get();
  return rotation ? withMembers(db, rotation) : null;
}

export function createRotation(input: RotationInput, actorId: string | null, now: Date = new Date()): RotationDetail {
  return db.transaction((tx) => {
    const row = tx
      .insert(rotations)
      .values({ calendarId: input.calendarId, ...configValues(input), createdBy: actorId })
      .returning()
      .get();
    const today = formatDateToLocal(now);
    writeMembers(tx, row.id, input, input.startDate < today ? input.startDate : today);
    return withMembers(tx, row);
  });
}

/** calendarId is fixed after creation; input.calendarId is ignored here. */
export function updateRotation(id: string, input: RotationInput, now: Date = new Date()): RotationDetail {
  let dayOffEvents: ReconcileEvent[] = []; // [fork] Dienstfrei
  const result = db.transaction((tx) => {
    const row = tx
      .update(rotations)
      .set({ ...configValues(input), updatedAt: now })
      .where(eq(rotations.id, id))
      .returning()
      .get();
    if (!row) throw new RotationServiceError("notFound");
    writeMembers(tx, id, input, formatDateToLocal(now));
    dayOffEvents = reconcileRotation(tx, id, now).events; // [fork] Dienstfrei
    return withMembers(tx, row);
  });
  logReconcileEventsLater(dayOffEvents); // [fork] Dienstfrei
  return result;
}

function loadExistingDuties(
  tx: Tx,
  rotationId: string,
  from: string,
  to: string,
  absences: Map<string, DateRange[]> // [fork] Urlaub
): ExistingDuty[] {
  const rows = tx
    .select({
      shiftId: rotationDuties.shiftId,
      date: rotationDuties.date,
      presetId: shifts.presetId,
      signupCapacity: shifts.signupCapacity,
      title: shifts.title,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      color: shifts.color,
      isAllDay: shifts.isAllDay,
      notes: shifts.notes,
    })
    .from(rotationDuties)
    .innerJoin(shifts, eq(shifts.id, rotationDuties.shiftId))
    .where(
      and(
        eq(rotationDuties.rotationId, rotationId),
        eq(rotationDuties.kind, "duty"),
        gte(rotationDuties.date, from),
        lte(rotationDuties.date, to)
      )
    )
    .all();
  if (rows.length === 0) return [];

  const shiftIds = rows.map((r) => r.shiftId);
  const signups = tx
    .select({ shiftId: shiftSignups.shiftId, userId: shiftSignups.userId })
    .from(shiftSignups)
    .where(inArray(shiftSignups.shiftId, shiftIds))
    .orderBy(asc(shiftSignups.createdAt))
    .all();
  const locks = tx
    .select()
    .from(rotationSlotLocks)
    .where(inArray(rotationSlotLocks.shiftId, shiftIds))
    .all();
  const lockKey = (shiftId: string, userId: string) => `${shiftId}|${userId}`;
  const lockByKey = new Map(locks.map((l) => [lockKey(l.shiftId, l.userId), l]));

  return rows.map((row) => ({
    ...row,
    slots: signups
      .filter((s) => s.shiftId === row.shiftId)
      .map((s) => {
        const lock = lockByKey.get(lockKey(s.shiftId, s.userId));
        const onVacation = (absences.get(s.userId) ?? []).some((r) => r.from <= row.date && row.date <= r.to); // [fork] Urlaub
        return { userId: s.userId, locked: Boolean(lock) && !onVacation, replacesUserId: lock?.replacesUserId ?? null };
      }),
  }));
}

function loadExistingClosures(tx: Tx, rotationId: string, from: string, to: string): ExistingClosure[] {
  return tx
    .select({
      shiftId: rotationDuties.shiftId,
      date: rotationDuties.date,
      presetId: shifts.presetId,
      signupCapacity: shifts.signupCapacity,
      title: shifts.title,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      color: shifts.color,
      isAllDay: shifts.isAllDay,
      notes: shifts.notes,
    })
    .from(rotationDuties)
    .innerJoin(shifts, eq(shifts.id, rotationDuties.shiftId))
    .where(
      and(
        eq(rotationDuties.rotationId, rotationId),
        eq(rotationDuties.kind, "closed"),
        gte(rotationDuties.date, from),
        lte(rotationDuties.date, to)
      )
    )
    .all();
}

async function loadTemplate(rotation: RotationDetail): Promise<Omit<PreparedGeneration, "rotationId">> {
  if (!rotation.presetId) throw new RotationServiceError("presetMissing");
  const preset = db.select().from(shiftPresets).where(eq(shiftPresets.id, rotation.presetId)).get();
  if (!preset || preset.calendarId !== rotation.calendarId) throw new RotationServiceError("presetMissing");
  if (preset.archivedAt) throw new RotationServiceError("presetArchived");
  const calendar = db.select().from(calendars).where(eq(calendars.id, rotation.calendarId)).get();
  if (!calendar?.signupsEnabled) throw new RotationServiceError("signupsDisabled");

  let segments: TimeRange[] = [];
  if (!preset.isAllDay && calendar.splitShiftsEnabled) {
    [{ segments }] = await withPresetSegments([preset]);
  }
  return {
    presetId: preset.id,
    template: {
      title: preset.title,
      startTime: preset.isAllDay ? "00:00" : preset.startTime,
      endTime: preset.isAllDay ? "23:59" : preset.endTime,
      color: preset.color,
      isAllDay: preset.isAllDay,
      notes: preset.notes,
    },
    segments,
    customFieldValues: await readPresetCustomFieldValues(preset.id),
  };
}

function buildPlan(
  tx: Tx,
  rotation: RotationDetail,
  from: string,
  to: string,
  template: DutyTemplate,
  presetId: string,
  now: Date,
  override?: VacationOverride // [fork] Urlaub
): GenerationPlan {
  // Duties before startDate belong to an earlier configuration and are left alone.
  const windowStart = from > rotation.startDate ? from : rotation.startDate;
  if (windowStart > to) return { entries: [], warnings: [], closures: [], openHolidays: [] };
  const absences = loadAbsences(tx, rotation.memberIds, override); // [fork] Urlaub
  const rule = toRule(tx, rotation, to, now, absences);
  const days = generateDays(rule, windowStart, to);
  // A day that has begun keeps what it holds: a Schließeintrag can no longer be written there,
  // so a duty on a newly closed begun day stays instead of leaving a gap. (A begun Schließeintrag
  // already counts as closed in the rule, so no duty is planned on its date.)
  const begunClosedDays = new Set(
    days.closures.filter((c) => hasStarted(c.date, CLOSURE_FIELDS.startTime, now)).map((c) => c.date)
  );
  const duties = planGeneration({
    desired: days.duties,
    existing: loadExistingDuties(tx, rotation.id, windowStart, to, absences).filter((d) => !begunClosedDays.has(d.date)),
    template,
    presetId,
    memberIds: rotation.memberIds,
    perShift: rotation.perShift,
    now,
  });
  const closures = planClosures({
    desired: days.closures,
    existing: loadExistingClosures(tx, rotation.id, windowStart, to),
    closedTitle: rotation.closedTitle,
    blockedDates: duties.warnings.filter((w) => w.kind === "lockedWithoutDuty").map((w) => w.date),
    now,
  });
  const openHolidays = rule.openHolidays.filter((h) => h.date >= windowStart && h.date <= to);
  return { ...duties, closures, openHolidays };
}

/** Loads what generation needs outside a transaction (presets may be read asynchronously). */
export async function prepareGeneration(id: string): Promise<PreparedGeneration> {
  return { rotationId: id, ...(await loadTemplate(loadRotation(db, id))) };
}

/** The plan for [from, to] inside a transaction; `override` previews a hypothetical vacation state. */
export function planInTx(
  tx: Tx,
  prepared: PreparedGeneration,
  from: string,
  to: string,
  now: Date,
  override?: VacationOverride
): GenerationPlan {
  const rotation = loadRotation(tx, prepared.rotationId);
  if (rotation.presetId !== prepared.presetId) throw new RotationServiceError("presetMissing");
  return buildPlan(tx, rotation, from, to, prepared.template, prepared.presetId, now, override);
}

/** Writes a plan: duties, Schließeinträge, freed locks; then reconciles the Dienstfreie. */
export function applyPlan(
  tx: Tx,
  prepared: PreparedGeneration,
  plan: GenerationPlan,
  actorId: string,
  now: Date
): { summary: GenerationSummary; dayOffEvents: ReconcileEvent[] } {
  const rotation = loadRotation(tx, prepared.rotationId);
  const loaded = prepared;
  const { template } = loaded;
  const summary: GenerationSummary = { created: 0, updated: 0, deleted: 0, unchanged: 0, warnings: plan.warnings.length };

  // Write order matters: the unique (rotation_id, date) index must never see two rows for one date.
  // (1) closure deletes, (2) duties, (3) closure creates/updates.
  for (const entry of plan.closures) {
    if (entry.kind !== "delete") continue;
    tx.delete(shifts).where(eq(shifts.id, entry.shiftId)).run();
    summary.deleted++;
  }

  for (const entry of plan.entries) {
    switch (entry.kind) {
      case "create": {
        const shift = tx
          .insert(shifts)
          .values({
            calendarId: rotation.calendarId,
            presetId: loaded.presetId,
            date: parseLocalDate(entry.date),
            ...template,
            signupCapacity: entry.capacity,
            createdBy: actorId,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        replaceShiftSegments(tx, shift.id, loaded.segments);
        replaceShiftCustomFieldValues(tx, shift.id, loaded.customFieldValues);
        tx.insert(rotationDuties).values({ shiftId: shift.id, rotationId: rotation.id, date: entry.date }).run();
        tx.insert(shiftSignups)
          .values(entry.userIds.map((userId) => ({ shiftId: shift.id, userId, signedUpBy: actorId })))
          .run();
        summary.created++;
        break;
      }
      case "update": {
        if (entry.remove.length > 0) {
          tx.delete(shiftSignups)
            .where(and(eq(shiftSignups.shiftId, entry.shiftId), inArray(shiftSignups.userId, entry.remove)))
            .run();
          tx.delete(rotationSlotLocks) // [fork] Urlaub: a freed lock goes with its Platz
            .where(and(eq(rotationSlotLocks.shiftId, entry.shiftId), inArray(rotationSlotLocks.userId, entry.remove)))
            .run();
        }
        if (entry.add.length > 0) {
          tx.insert(shiftSignups)
            .values(entry.add.map((userId) => ({ shiftId: entry.shiftId, userId, signedUpBy: actorId })))
            .run();
        }
        if (entry.fieldsChanged) {
          tx.update(shifts)
            .set({ ...template, presetId: loaded.presetId, signupCapacity: entry.capacity, updatedAt: now })
            .where(eq(shifts.id, entry.shiftId))
            .run();
          replaceShiftSegments(tx, entry.shiftId, loaded.segments);
          replaceShiftCustomFieldValues(tx, entry.shiftId, loaded.customFieldValues);
        } else if (entry.capacityChanged) {
          tx.update(shifts).set({ signupCapacity: entry.capacity, updatedAt: now }).where(eq(shifts.id, entry.shiftId)).run();
        }
        summary.updated++;
        break;
      }
      case "delete":
        tx.delete(shifts).where(eq(shifts.id, entry.shiftId)).run();
        summary.deleted++;
        break;
      case "unchanged":
        summary.unchanged++;
        break;
    }
  }

  for (const entry of plan.closures) {
    switch (entry.kind) {
      case "create": {
        const shift = tx
          .insert(shifts)
          .values({
            calendarId: rotation.calendarId,
            presetId: null,
            date: parseLocalDate(entry.date),
            ...CLOSURE_FIELDS,
            title: entry.title,
            signupCapacity: 0,
            createdBy: actorId,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        tx.insert(rotationDuties).values({ shiftId: shift.id, rotationId: rotation.id, date: entry.date, kind: "closed" }).run();
        summary.created++;
        break;
      }
      case "update":
        tx.update(shifts)
          .set({ ...CLOSURE_FIELDS, title: entry.title, presetId: null, signupCapacity: 0, updatedAt: now })
          .where(eq(shifts.id, entry.shiftId))
          .run();
        replaceShiftSegments(tx, entry.shiftId, []);
        summary.updated++;
        break;
      case "unchanged":
        summary.unchanged++;
        break;
    }
  }
  const dayOffEvents = reconcileRotation(tx, rotation.id, now).events; // [fork] Dienstfrei
  return { summary, dayOffEvents };
}

export async function runGeneration(
  id: string,
  from: string,
  to: string,
  actorId: string,
  now: Date
): Promise<GenerationSummary> {
  const prepared = await prepareGeneration(id);
  const { summary, dayOffEvents } = db.transaction((tx) =>
    applyPlan(tx, prepared, planInTx(tx, prepared, from, to, now), actorId, now)
  );
  logReconcileEventsLater(dayOffEvents); // [fork] Dienstfrei
  return summary;
}

export async function previewGeneration(id: string, from: string, to: string, now: Date): Promise<GenerationPlan> {
  const prepared = await prepareGeneration(id);
  return db.transaction((tx) => planInTx(tx, prepared, from, to, now));
}

/** [fork] Urlaub: the date of the rotation's last written entry (the bisheriges Planende). */
export function planEnd(reader: Tx | typeof db, rotationId: string): string | null {
  return (
    reader
      .select({ date: rotationDuties.date })
      .from(rotationDuties)
      .where(eq(rotationDuties.rotationId, rotationId))
      .orderBy(desc(rotationDuties.date))
      .limit(1)
      .get()?.date ?? null
  );
}

/** [fork] Urlaub: rotations in which the user is a Teilnehmer. */
export function rotationsOfMember(reader: Tx | typeof db, userId: string): { id: string; name: string; calendarId: string }[] {
  return reader
    .select({ id: rotations.id, name: rotations.name, calendarId: rotations.calendarId })
    .from(rotationMembers)
    .innerJoin(rotations, eq(rotations.id, rotationMembers.rotationId))
    .where(eq(rotationMembers.userId, userId))
    .orderBy(asc(rotations.name))
    .all();
}

/** startOffset suggestion for restarting at restartDate with a new member order. */
export function suggestOffsetFor(id: string, restartDate: string, memberIds: string[]): number {
  const last = db
    .select({ shiftId: rotationDuties.shiftId })
    .from(rotationDuties)
    .where(and(eq(rotationDuties.rotationId, id), eq(rotationDuties.kind, "duty"), lt(rotationDuties.date, restartDate)))
    .orderBy(desc(rotationDuties.date))
    .limit(1)
    .get();
  if (!last) return 0;
  const userIds = db
    .select({ userId: shiftSignups.userId })
    .from(shiftSignups)
    .where(eq(shiftSignups.shiftId, last.shiftId))
    .all()
    .map((s) => s.userId);
  return suggestStartOffset(memberIds, userIds, loadRotation(db, id).perShift);
}

/** [fork] Jahresausgleich: the Delta tables of this year and the next, as the generator settles them. */
export function getYearDeltaTables(id: string, now: Date): YearDeltaTable[] {
  const rotation = loadRotation(db, id);
  const year = now.getFullYear();
  // Counted as if switched on, so a manager sees the numbers before turning it on.
  // [fork] Urlaub: count with the approved vacations, as generation does.
  const rule = toRule(db, { ...rotation, yearlyFairness: true }, `${year + 1}-12-31`, now, loadAbsences(db, rotation.memberIds));
  return [year, year + 1].flatMap((y) => {
    const rows = yearSummary(rule, y);
    return rows ? [{ year: y, rows: rows.map((r) => ({ ...r, joinedOn: rotation.memberSince[r.userId] ?? rotation.startDate })) }] : [];
  });
}

/** [fork] Jahresausgleich: sets (or with delta null removes) a manager's Delta. */
export function setYearDeltaOverride(
  id: string,
  { year, userId, delta }: { year: number; userId: string; delta: number | null },
  actorId: string | null,
  now: Date
): RotationDetail {
  const rotation = loadRotation(db, id);
  if (!rotation.memberIds.includes(userId)) throw new RotationServiceError("notMember");
  const key = and(eq(rotationYearDeltas.rotationId, id), eq(rotationYearDeltas.year, year), eq(rotationYearDeltas.userId, userId));
  if (delta === null) {
    db.delete(rotationYearDeltas).where(key).run();
  } else {
    db.insert(rotationYearDeltas)
      .values({ rotationId: id, year, userId, delta, setBy: actorId, setAt: now })
      .onConflictDoUpdate({
        target: [rotationYearDeltas.rotationId, rotationYearDeltas.year, rotationYearDeltas.userId],
        set: { delta, setBy: actorId, setAt: now },
      })
      .run();
  }
  return rotation;
}

export function deleteRotation(
  id: string,
  { deleteFutureDuties }: { deleteFutureDuties: boolean },
  now: Date
): { deletedDuties: number } {
  return db.transaction((tx) => {
    let deletedDuties = 0;
    if (deleteFutureDuties) {
      const entries = tx
        .select({
          shiftId: rotationDuties.shiftId,
          date: rotationDuties.date,
          kind: rotationDuties.kind,
          startTime: shifts.startTime,
        })
        .from(rotationDuties)
        .innerJoin(shifts, eq(shifts.id, rotationDuties.shiftId))
        .where(eq(rotationDuties.rotationId, id))
        .all()
        .filter((d) => !hasStarted(d.date, d.startTime, now));
      if (entries.length > 0) {
        tx.delete(shifts).where(inArray(shifts.id, entries.map((d) => d.shiftId))).run();
      }
      // Schließeinträge go too, but only duties are reported.
      deletedDuties = entries.filter((d) => d.kind === "duty").length;
    }
    // Remaining (past) shifts stay as plain shifts once their rotation_duties rows cascade away.
    const removed = tx.delete(rotations).where(eq(rotations.id, id)).returning().all();
    if (removed.length === 0) throw new RotationServiceError("notFound");
    return { deletedDuties };
  });
}

/** Lifts a Gesperrter Platz of one of this rotation's duties. */
export function removeSlotLock(shiftId: string, userId: string, rotationId: string): boolean {
  const duty = db
    .select()
    .from(rotationDuties)
    .where(and(eq(rotationDuties.shiftId, shiftId), eq(rotationDuties.rotationId, rotationId)))
    .get();
  if (!duty) return false;
  const removed = db
    .delete(rotationSlotLocks)
    .where(and(eq(rotationSlotLocks.shiftId, shiftId), eq(rotationSlotLocks.userId, userId)))
    .returning()
    .all();
  return removed.length > 0;
}
