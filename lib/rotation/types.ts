export const ROTATION_PERIODS = ["day", "week", "days"] as const;
export type RotationPeriod = (typeof ROTATION_PERIODS)[number];

/** Everything the round-robin needs; no database identifiers beyond user ids. */
export interface RotationRule {
  /** Teilnehmer in rotation order (index = position). */
  memberIds: string[];
  perShift: number;
  period: RotationPeriod;
  /** Only for period "days". */
  periodDays: number | null;
  /** Local YYYY-MM-DD; the first period starts here (a partial week for "week"). */
  startDate: string;
  /** Position of the Teilnehmer who takes the first slot of the first duty. */
  startOffset: number;
  /** ISO weekdays 1 = Monday … 7 = Sunday; empty = every day. */
  weekdays: number[];
  /** Ausfalltage: local YYYY-MM-DD dates without a duty. */
  skipDates: string[];
}

export interface PlannedDuty {
  date: string;
  userIds: string[];
}
