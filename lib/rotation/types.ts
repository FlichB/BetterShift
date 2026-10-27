export const ROTATION_PERIODS = ["day", "week", "days"] as const;
export type RotationPeriod = (typeof ROTATION_PERIODS)[number];

/** An Ausfalltag: a Schließtag for a reason of the Verantwortlicher. */
export interface SkipDate {
  date: string;
  reason: string;
}

/** "duty" = Dienst with Plätze, "closed" = Schließeintrag without Plätze. */
export type RotationDutyKind = "duty" | "closed";

/** A Feiertag as read from the Feiertagskalender. */
export interface Holiday {
  date: string;
  name: string;
}

export type ClosureSource = "skip" | "holiday";

/** A Schließtag handed to the generator; reason goes into the Schließeintrag's title. */
export interface ClosedDate {
  date: string;
  reason: string;
  source: ClosureSource;
}

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
  /** Schließtage: Ausfalltage and Feiertage that are not opened. */
  closedDates: ClosedDate[];
  /** Geöffnete Feiertage; only shown in the preview. */
  openHolidays: Holiday[];
}

export interface PlannedDuty {
  date: string;
  userIds: string[];
  /** Name of a Geöffneter Feiertag on this date; absent otherwise. */
  openHoliday?: string;
}

export interface PlannedDays {
  duties: PlannedDuty[];
  closures: ClosedDate[];
}
