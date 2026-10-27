// [fork] Dienstfrei (SPEC 12.34–12.39, design docs/superpowers/specs/2026-10-27-dienstfrei-design.md).
export type DayOffStatus = "standard" | "moved" | "locked" | "agreed" | "dropped";
export type ProposalSide = "holder" | "manager";
export type ProposalStatus = "open" | "accepted" | "declined" | "void";
export type DropReason = "noDuty" | "disabled" | "seatRemoved";
export type DayOffAudience = "holder" | "managers";
export type DayOffNotificationKind =
  | "day_off_locked"
  | "day_off_proposed"
  | "day_off_countered"
  | "day_off_accepted"
  | "day_off_declined"
  | "day_off_reset"
  | "day_off_dropped"
  | "day_off_reminder";
export type DayOffErrorCode =
  | "notFound"
  | "forbidden"
  | "invalid"
  | "notHolder"
  | "wrongStatus"
  | "alreadyStarted"
  | "notWorkday"
  | "outsideWeek"
  | "outsideWindow"
  | "taken"
  | "duplicate"
  | "tooMany"
  | "reasonRequired"
  | "proposalNotOpen";

export const MAX_DATES_PER_PROPOSAL = 5;
export const MAX_OPEN_PROPOSALS = 10;
export const REMINDER_AFTER_DAYS = 3;
export const DEFAULT_DAY_OFF_TITLE = "{Vorname} dienstfrei";

export interface DayOffProposalView { id: string; date: string; side: ProposalSide; status: ProposalStatus; declineReason: string | null; createdAt: string }
export interface DayOffView {
  id: string;
  calendarId: string;
  calendarName: string;
  rotationId: string;
  dutyDate: string;
  dutyTitle: string;
  holder: { id: string; name: string };
  status: DayOffStatus;
  date: string | null;
  standardDate: string | null;
  lockNote: string | null;
  dropReason: DropReason | null;
  windowEnd: string;
  proposals: DayOffProposalView[];
  /** Filled by the route; the service always returns false. */
  canMove: boolean;
}
export interface DayOffBoard { mine: DayOffView[]; manage: DayOffView[]; manageCalendarIds: string[] }
export interface MoveOption { date: string; othersOff: number; isCurrent: boolean; isStandard: boolean }
