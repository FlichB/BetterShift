import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars, shiftPresets, shiftSignups, shifts } from "@/lib/db/schema";
import { parseLocalDate } from "@/lib/date-utils";
import { replaceShiftSegments, withPresetSegments } from "@/lib/shift-time-ranges";
import {
  readPresetCustomFieldValues,
  type CustomFieldValueRow,
  replaceShiftCustomFieldValues,
} from "@/lib/shift-custom-fields";
import type { TimeRange } from "@/lib/time-ranges";
import { hasStarted } from "@/lib/rotation/dates";
import { generateDuties, suggestStartOffset } from "@/lib/rotation/generate";
import {
  planGeneration,
  type DutyTemplate,
  type ExistingDuty,
  type GenerationPlan,
} from "@/lib/rotation/plan";
import {
  rotationDuties,
  rotationMembers,
  rotationSlotLocks,
  rotations,
  type Rotation,
} from "@/lib/rotation/schema";
import type { RotationRule } from "@/lib/rotation/types";
import type { RotationInput } from "@/lib/rotation/validate";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface RotationDetail extends Rotation {
  memberIds: string[];
}

export type RotationError = "notFound" | "presetMissing" | "presetArchived" | "signupsDisabled";

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

interface LoadedTemplate {
  presetId: string;
  template: DutyTemplate;
  segments: TimeRange[];
  customFieldValues: CustomFieldValueRow[];
}

function withMembers(tx: Tx | typeof db, rotation: Rotation): RotationDetail {
  const memberIds = tx
    .select({ userId: rotationMembers.userId })
    .from(rotationMembers)
    .where(eq(rotationMembers.rotationId, rotation.id))
    .orderBy(asc(rotationMembers.position))
    .all()
    .map((m) => m.userId);
  return { ...rotation, memberIds };
}

function loadRotation(tx: Tx | typeof db, id: string): RotationDetail {
  const rotation = tx.select().from(rotations).where(eq(rotations.id, id)).get();
  if (!rotation) throw new RotationServiceError("notFound");
  return withMembers(tx, rotation);
}

function toRule(r: RotationDetail): RotationRule {
  return {
    memberIds: r.memberIds,
    perShift: r.perShift,
    period: r.period,
    periodDays: r.periodDays,
    startDate: r.startDate,
    startOffset: r.startOffset,
    weekdays: r.weekdays,
    skipDates: r.skipDates,
  };
}

function writeMembers(tx: Tx, rotationId: string, memberIds: string[]): void {
  tx.delete(rotationMembers).where(eq(rotationMembers.rotationId, rotationId)).run();
  tx.insert(rotationMembers)
    .values(memberIds.map((userId, position) => ({ rotationId, userId, position })))
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

export function createRotation(input: RotationInput, actorId: string | null): RotationDetail {
  return db.transaction((tx) => {
    const row = tx
      .insert(rotations)
      .values({ calendarId: input.calendarId, ...configValues(input), createdBy: actorId })
      .returning()
      .get();
    writeMembers(tx, row.id, input.memberIds);
    return withMembers(tx, row);
  });
}

/** calendarId is fixed after creation; input.calendarId is ignored here. */
export function updateRotation(id: string, input: RotationInput): RotationDetail {
  return db.transaction((tx) => {
    const row = tx
      .update(rotations)
      .set({ ...configValues(input), updatedAt: new Date() })
      .where(eq(rotations.id, id))
      .returning()
      .get();
    if (!row) throw new RotationServiceError("notFound");
    writeMembers(tx, id, input.memberIds);
    return withMembers(tx, row);
  });
}

function loadExistingDuties(tx: Tx, rotationId: string, from: string, to: string): ExistingDuty[] {
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
      and(eq(rotationDuties.rotationId, rotationId), gte(rotationDuties.date, from), lte(rotationDuties.date, to))
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
        return { userId: s.userId, locked: Boolean(lock), replacesUserId: lock?.replacesUserId ?? null };
      }),
  }));
}

async function loadTemplate(rotation: RotationDetail): Promise<LoadedTemplate> {
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

function buildPlan(tx: Tx, rotation: RotationDetail, from: string, to: string, template: DutyTemplate, presetId: string, now: Date) {
  // Duties before startDate belong to an earlier configuration and are left alone.
  const windowStart = from > rotation.startDate ? from : rotation.startDate;
  if (windowStart > to) return { entries: [], warnings: [] };
  return planGeneration({
    desired: generateDuties(toRule(rotation), windowStart, to),
    existing: loadExistingDuties(tx, rotation.id, windowStart, to),
    template,
    presetId,
    memberIds: rotation.memberIds,
    perShift: rotation.perShift,
    now,
  });
}

export async function previewGeneration(id: string, from: string, to: string, now: Date): Promise<GenerationPlan> {
  const rotation = loadRotation(db, id);
  const { template, presetId } = await loadTemplate(rotation);
  return db.transaction((tx) => buildPlan(tx, rotation, from, to, template, presetId, now));
}

export async function runGeneration(
  id: string,
  from: string,
  to: string,
  actorId: string,
  now: Date
): Promise<GenerationSummary> {
  const loaded = await loadTemplate(loadRotation(db, id));
  const { template } = loaded;

  return db.transaction((tx) => {
    const rotation = loadRotation(tx, id);
    if (rotation.presetId !== loaded.presetId) throw new RotationServiceError("presetMissing");
    const plan = buildPlan(tx, rotation, from, to, template, loaded.presetId, now);
    const summary: GenerationSummary = { created: 0, updated: 0, deleted: 0, unchanged: 0, warnings: plan.warnings.length };

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
              signupCapacity: rotation.perShift,
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
          }
          if (entry.add.length > 0) {
            tx.insert(shiftSignups)
              .values(entry.add.map((userId) => ({ shiftId: entry.shiftId, userId, signedUpBy: actorId })))
              .run();
          }
          if (entry.fieldsChanged) {
            tx.update(shifts)
              .set({ ...template, presetId: loaded.presetId, signupCapacity: rotation.perShift, updatedAt: now })
              .where(eq(shifts.id, entry.shiftId))
              .run();
            replaceShiftSegments(tx, entry.shiftId, loaded.segments);
            replaceShiftCustomFieldValues(tx, entry.shiftId, loaded.customFieldValues);
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
    return summary;
  });
}

/** startOffset suggestion for restarting at restartDate with a new member order. */
export function suggestOffsetFor(id: string, restartDate: string, memberIds: string[]): number {
  const last = db
    .select({ shiftId: rotationDuties.shiftId })
    .from(rotationDuties)
    .where(and(eq(rotationDuties.rotationId, id), lt(rotationDuties.date, restartDate)))
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
  return suggestStartOffset(memberIds, userIds);
}

export function deleteRotation(
  id: string,
  { deleteFutureDuties }: { deleteFutureDuties: boolean },
  now: Date
): { deletedDuties: number } {
  return db.transaction((tx) => {
    let deletedDuties = 0;
    if (deleteFutureDuties) {
      const duties = tx
        .select({ shiftId: rotationDuties.shiftId, date: rotationDuties.date, startTime: shifts.startTime })
        .from(rotationDuties)
        .innerJoin(shifts, eq(shifts.id, rotationDuties.shiftId))
        .where(eq(rotationDuties.rotationId, id))
        .all()
        .filter((d) => !hasStarted(d.date, d.startTime, now));
      if (duties.length > 0) {
        tx.delete(shifts).where(inArray(shifts.id, duties.map((d) => d.shiftId))).run();
      }
      deletedDuties = duties.length;
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
