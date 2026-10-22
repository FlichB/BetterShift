import { hasStarted } from "@/lib/rotation/dates";
import type { PlannedDuty } from "@/lib/rotation/types";

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
  | { kind: "create"; date: string; userIds: string[] }
  | {
      kind: "update";
      shiftId: string;
      date: string;
      userIds: string[];
      locked: string[];
      add: string[];
      remove: string[];
      fieldsChanged: boolean;
    }
  | { kind: "unchanged"; shiftId: string; date: string; userIds: string[]; locked: string[] }
  | { kind: "delete"; shiftId: string; date: string; userIds: string[] };

export type PlanWarning =
  | { kind: "lockedNonMember"; shiftId: string; date: string; userId: string }
  | { kind: "lockedWithoutDuty"; shiftId: string; date: string; userIds: string[] };

export interface GenerationPlan {
  entries: PlanEntry[];
  warnings: PlanWarning[];
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
export function planGeneration(input: PlanInput): GenerationPlan {
  const { desired, template, presetId, memberIds, perShift, now } = input;
  const members = new Set(memberIds);
  const existingByDate = new Map(input.existing.map((e) => [e.date, e]));
  const entries: PlanEntry[] = [];
  const warnings: PlanWarning[] = [];

  for (const duty of desired) {
    const current = existingByDate.get(duty.date);
    existingByDate.delete(duty.date);

    if (!current) {
      if (!hasStarted(duty.date, template.startTime, now)) {
        entries.push({ kind: "create", date: duty.date, userIds: duty.userIds });
      }
      continue;
    }
    if (hasStarted(current.date, current.startTime, now)) continue;

    const locked = current.slots.filter((s) => s.locked).map((s) => s.userId);
    const replaced = new Set(
      current.slots.filter((s) => s.locked && s.replacesUserId).map((s) => s.replacesUserId as string)
    );
    const target = [
      ...locked,
      ...duty.userIds.filter((id) => !replaced.has(id) && !locked.includes(id)),
    ].slice(0, Math.max(perShift, locked.length));

    for (const userId of locked) {
      if (!members.has(userId)) {
        warnings.push({ kind: "lockedNonMember", shiftId: current.shiftId, date: current.date, userId });
      }
    }

    const actual = current.slots.map((s) => s.userId);
    const add = target.filter((id) => !actual.includes(id));
    const remove = actual.filter((id) => !target.includes(id));
    const fieldsChanged =
      fieldsDiffer(current, template) || current.presetId !== presetId || current.signupCapacity !== perShift;

    if (add.length === 0 && remove.length === 0 && !fieldsChanged) {
      entries.push({ kind: "unchanged", shiftId: current.shiftId, date: current.date, userIds: target, locked });
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
