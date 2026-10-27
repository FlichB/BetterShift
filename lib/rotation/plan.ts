import { hasStarted } from "@/lib/rotation/dates";
import { CLOSURE_FIELDS, closureTitle } from "@/lib/rotation/closures";
import type { ClosedDate, ClosureSource, Holiday, PlannedDuty } from "@/lib/rotation/types";

export interface DutyTemplate {
  title: string;
  startTime: string;
  endTime: string;
  color: string;
  isAllDay: boolean;
  notes: string | null;
}

export interface ExistingSlot {
  userId: string;
  locked: boolean;
  /** For a locked slot: the Teilnehmer whose slot it took over in a swap. */
  replacesUserId: string | null;
}

export interface ExistingDuty extends DutyTemplate {
  shiftId: string;
  date: string;
  presetId: string | null;
  signupCapacity: number | null;
  slots: ExistingSlot[];
}

export type PlanEntry =
  | { kind: "create"; date: string; userIds: string[]; capacity: number }
  | {
      kind: "update";
      shiftId: string;
      date: string;
      userIds: string[];
      locked: string[];
      add: string[];
      remove: string[];
      fieldsChanged: boolean;
      capacity: number;
    }
  | { kind: "unchanged"; shiftId: string; date: string; userIds: string[]; locked: string[]; capacity: number }
  | { kind: "delete"; shiftId: string; date: string; userIds: string[] };

export type PlanWarning =
  | { kind: "lockedNonMember"; shiftId: string; date: string; userId: string }
  | { kind: "lockedWithoutDuty"; shiftId: string; date: string; userIds: string[] }
  | { kind: "lockedOverCapacity"; shiftId: string; date: string; userIds: string[]; capacity: number };

export interface ExistingClosure extends DutyTemplate {
  shiftId: string;
  date: string;
  presetId: string | null;
  signupCapacity: number | null;
}

export type ClosureEntry =
  | { kind: "create"; date: string; title: string; source: ClosureSource }
  | { kind: "update"; shiftId: string; date: string; title: string; source: ClosureSource }
  | { kind: "unchanged"; shiftId: string; date: string; title: string; source: ClosureSource }
  | { kind: "delete"; shiftId: string; date: string; title: string };

export interface DutyPlan {
  entries: PlanEntry[];
  warnings: PlanWarning[];
}

export interface GenerationPlan extends DutyPlan {
  closures: ClosureEntry[];
  openHolidays: Holiday[];
}

export interface PlanInput {
  desired: PlannedDuty[];
  existing: ExistingDuty[];
  template: DutyTemplate;
  /** Preset the template was read from; duties pointing elsewhere get re-synced. */
  presetId: string;
  memberIds: string[];
  perShift: number;
  now: Date;
}

function fieldsDiffer(a: DutyTemplate, b: DutyTemplate): boolean {
  return (
    a.title !== b.title ||
    a.startTime !== b.startTime ||
    a.endTime !== b.endTime ||
    a.color !== b.color ||
    a.isAllDay !== b.isAllDay ||
    a.notes !== b.notes
  );
}

/** Diffs planned against stored duties; never plans anything for a started duty. */
export function planGeneration(input: PlanInput): DutyPlan {
  const { desired, template, presetId, memberIds, perShift, now } = input;
  const members = new Set(memberIds);
  const existingByDate = new Map(input.existing.map((e) => [e.date, e]));
  const entries: PlanEntry[] = [];
  const warnings: PlanWarning[] = [];

  for (const duty of desired) {
    const capacity = duty.capacity ?? perShift;
    const current = existingByDate.get(duty.date);
    existingByDate.delete(duty.date);

    if (!current) {
      if (!hasStarted(duty.date, template.startTime, now)) {
        entries.push({ kind: "create", date: duty.date, userIds: duty.userIds, capacity });
      }
      continue;
    }
    if (hasStarted(current.date, current.startTime, now)) continue;

    const locked = current.slots.filter((s) => s.locked).map((s) => s.userId);
    const replaced = new Set(
      current.slots.filter((s) => s.locked && s.replacesUserId).map((s) => s.replacesUserId as string)
    );
    const seats = Math.max(capacity, locked.length); // locked Plätze always stay (spec 12.8)
    const target = [
      ...locked,
      ...duty.userIds.filter((id) => !replaced.has(id) && !locked.includes(id)),
    ].slice(0, seats);
    if (locked.length > capacity) {
      warnings.push({ kind: "lockedOverCapacity", shiftId: current.shiftId, date: current.date, userIds: locked, capacity });
    }

    for (const userId of locked) {
      if (!members.has(userId)) {
        warnings.push({ kind: "lockedNonMember", shiftId: current.shiftId, date: current.date, userId });
      }
    }

    const actual = current.slots.map((s) => s.userId);
    const add = target.filter((id) => !actual.includes(id));
    const remove = actual.filter((id) => !target.includes(id));
    const fieldsChanged =
      fieldsDiffer(current, template) || current.presetId !== presetId || current.signupCapacity !== seats;

    if (add.length === 0 && remove.length === 0 && !fieldsChanged) {
      entries.push({ kind: "unchanged", shiftId: current.shiftId, date: current.date, userIds: target, locked, capacity: seats });
    } else {
      entries.push({
        kind: "update",
        shiftId: current.shiftId,
        date: current.date,
        userIds: target,
        locked,
        add,
        remove,
        fieldsChanged,
        capacity: seats,
      });
    }
  }

  for (const current of existingByDate.values()) {
    if (hasStarted(current.date, current.startTime, now)) continue;
    const locked = current.slots.filter((s) => s.locked).map((s) => s.userId);
    if (locked.length > 0) {
      warnings.push({ kind: "lockedWithoutDuty", shiftId: current.shiftId, date: current.date, userIds: locked });
      continue;
    }
    entries.push({
      kind: "delete",
      shiftId: current.shiftId,
      date: current.date,
      userIds: current.slots.map((s) => s.userId),
    });
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));
  warnings.sort((a, b) => a.date.localeCompare(b.date));
  return { entries, warnings };
}

export interface ClosurePlanInput {
  desired: ClosedDate[];
  existing: ExistingClosure[];
  closedTitle: string;
  /** Dates whose duty stays because of locked Plätze; no Schließeintrag there. */
  blockedDates: string[];
  now: Date;
}

/** Diffs planned against stored Schließeinträge; never plans anything for a started day. */
export function planClosures(input: ClosurePlanInput): ClosureEntry[] {
  const blocked = new Set(input.blockedDates);
  const existingByDate = new Map(input.existing.map((e) => [e.date, e]));
  const entries: ClosureEntry[] = [];
  const target: DutyTemplate = { ...CLOSURE_FIELDS, title: "" };

  for (const closure of input.desired) {
    const current = existingByDate.get(closure.date);
    existingByDate.delete(closure.date);
    if (hasStarted(closure.date, CLOSURE_FIELDS.startTime, input.now) || blocked.has(closure.date)) continue;
    const title = closureTitle(input.closedTitle, closure.reason);
    if (!current) {
      entries.push({ kind: "create", date: closure.date, title, source: closure.source });
      continue;
    }
    const changed =
      fieldsDiffer(current, { ...target, title }) || current.presetId !== null || current.signupCapacity !== 0;
    entries.push({ kind: changed ? "update" : "unchanged", shiftId: current.shiftId, date: closure.date, title, source: closure.source });
  }

  for (const current of existingByDate.values()) {
    if (hasStarted(current.date, current.startTime, input.now)) continue;
    entries.push({ kind: "delete", shiftId: current.shiftId, date: current.date, title: current.title });
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}
