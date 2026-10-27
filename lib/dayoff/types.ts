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
