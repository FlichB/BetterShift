// [fork] How far ahead an external sync imports events. Pure and client-safe (no database imports).

/** Default: up to 31.12. of the year after next, so a whole next year can be planned with its Feiertage. */
export const DEFAULT_YEARS_AHEAD = 2;
export const MAX_YEARS_AHEAD = 10;

/** Choices offered in the form: 0 = end of the current year. */
export const YEARS_AHEAD_CHOICES = Array.from({ length: MAX_YEARS_AHEAD + 1 }, (_, n) => n);

export function isValidYearsAhead(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_YEARS_AHEAD;
}

/** Last moment a sync imports: 31.12. of now's year + yearsAhead, local time. */
export function syncWindowEnd(now: Date, yearsAhead: number = DEFAULT_YEARS_AHEAD): Date {
  return new Date(now.getFullYear() + yearsAhead, 11, 31, 23, 59, 59, 999);
}
