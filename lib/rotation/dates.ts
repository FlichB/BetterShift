// Pure calendar-day arithmetic on local YYYY-MM-DD strings. Day numbers are
// days since 1970-01-01 computed via Date.UTC, so DST never shifts a day.

const DAY_MS = 86_400_000;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, "0");

export function toDayNumber(date: string): number {
  const match = LOCAL_DATE.exec(date);
  if (!match) throw new TypeError(`Invalid date "${date}", expected YYYY-MM-DD`);
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
}

export function fromDayNumber(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isValidLocalDate(date: string): boolean {
  return LOCAL_DATE.test(date) && fromDayNumber(toDayNumber(date)) === date;
}

/** ISO weekday, 1 = Monday … 7 = Sunday. Day 0 (1970-01-01) was a Thursday. */
export function isoWeekday(day: number): number {
  return (((day + 3) % 7) + 7) % 7 + 1;
}

export function mondayOf(day: number): number {
  return day - (isoWeekday(day) - 1);
}

export function addDays(date: string, n: number): string {
  return fromDayNumber(toDayNumber(date) + n);
}

/** Whether a duty starting at local `date` + `startTime` (HH:mm) has begun at `now`. */
export function hasStarted(date: string, startTime: string, now: Date): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = startTime.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime() <= now.getTime();
}
