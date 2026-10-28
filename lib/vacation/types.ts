// [fork] Urlaub (SPEC 12.43, design docs/superpowers/specs/2026-10-28-urlaub-design.md).
import type { PlanWarning } from "@/lib/rotation/plan";

export type VacationStatus = "pending" | "approved" | "rejected" | "withdrawn" | "cancelled";
export type ChangeKind = "change" | "cancel";
export type ChangeStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type VacationNotificationKind =
  | "vacation_requested"
  | "vacation_change_requested"
  | "vacation_approved"
  | "vacation_rejected"
  | "vacation_change_approved"
  | "vacation_change_rejected"
  | "vacation_entered"
  | "vacation_changed"
  | "vacation_cancelled";
export type VacationErrorCode =
  | "notFound"
  | "forbidden"
  | "invalid"
  | "notParticipant"
  | "tooLong"
  | "begun"
  | "overlap"
  | "wrongStatus"
  | "changePending"
  | "reasonRequired";

export const MAX_VACATION_DAYS = 366;
export const MAX_NOTE_LENGTH = 500;

/** A date range, both ends inclusive. */
export interface DateRange {
  from: string;
  to: string;
}

/** The actions that change approved vacations; each one previews and replans. */
export type VacationAction =
  | { kind: "approve"; vacationId: string }
  | { kind: "enter"; userId: string; startDate: string; endDate: string }
  | { kind: "change"; vacationId: string; startDate: string; endDate: string }
  | { kind: "cancel"; vacationId: string }
  | { kind: "approveChange"; changeId: string };

export interface VacationChangeView {
  id: string;
  kind: ChangeKind;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  status: ChangeStatus;
  decisionNote: string | null;
}

export interface VacationView {
  id: string;
  user: { id: string; name: string };
  startDate: string;
  endDate: string;
  note: string | null;
  status: VacationStatus;
  decisionNote: string | null;
  /** Entered by the Verwaltung rather than requested by the person. */
  direct: boolean;
  pendingChange: VacationChangeView | null;
}

export interface VacationBoard {
  mine: VacationView[];
  /** Approved and pending vacations of everyone the caller manages, for the Urlaubskalender. */
  team: VacationView[];
  /** Pending requests and pending change requests the caller decides. */
  requests: VacationView[];
  people: { id: string; name: string }[];
  isManager: boolean;
  canRequest: boolean;
}

export interface RotationPreview {
  rotationId: string;
  rotationName: string;
  calendarName: string;
  changes: { date: string; before: string[]; after: string[] }[];
  warnings: PlanWarning[];
}

export interface VacationPreview {
  rotations: RotationPreview[];
}
