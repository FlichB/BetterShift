// [fork] Jahresausgleich (SPEC 12.41): Delta per Teilnehmer. Pure and client-safe (no database imports).

/** Plätze per person in one calendar year and the first Diensttag that year (null = no duty). */
export interface YearTally {
  counts: ReadonlyMap<string, number>;
  firstDate: string | null;
}

export interface YearDeltaRow {
  userId: string;
  /** Plätze held in the counted year, rounded; null for start values (nothing counted before the rotation). */
  held: number | null;
  /** Teilnehmer since the first Diensttag of the counted year at the latest. */
  fullYear: boolean;
  autoDelta: number;
  override: number | null;
  /** override ?? autoDelta: what the generator settles. */
  delta: number;
}

/** Deltas the year `year` settles, counted in year − 1. */
export interface YearDeltaTable {
  year: number;
  rows: (YearDeltaRow & { joinedOn: string })[];
}

export const MAX_YEAR_DELTA = 52;

/**
 * Delta = held − fewest held of a Ganzjahres-Teilnehmer; later joiners get 0 and do not count
 * towards the minimum. A missing memberSince counts as full-year. Null when the year had no duty.
 */
export function yearDeltaRows(
  memberIds: readonly string[],
  memberSince: Readonly<Record<string, string>> | undefined,
  tally: YearTally,
  overrides: Readonly<Record<string, number>> | undefined
): YearDeltaRow[] | null {
  const firstDate = tally.firstDate;
  if (firstDate === null) return null;
  const held = (u: string) => Math.round(tally.counts.get(u) ?? 0);
  const isFullYear = (u: string) => (memberSince?.[u] ?? "") <= firstDate;
  const full = memberIds.filter(isFullYear);
  const min = full.length > 0 ? Math.min(...full.map(held)) : 0;
  return memberIds.map((userId) => {
    const fullYear = isFullYear(userId);
    const autoDelta = fullYear ? held(userId) - min : 0;
    const override = overrides?.[userId] ?? null;
    return { userId, held: held(userId), fullYear, autoDelta, override, delta: override ?? autoDelta };
  });
}

/**
 * Start values for the first year of a rotation that counted nothing in the year before: Delta 0
 * unless a manager carries one over from the planning before the rotation.
 */
export function startDeltaRows(memberIds: readonly string[], overrides: Readonly<Record<string, number>> | undefined): YearDeltaRow[] {
  return memberIds.map((userId) => {
    const override = overrides?.[userId] ?? null;
    return { userId, held: null, fullYear: true, autoDelta: 0, override, delta: override ?? 0 };
  });
}

/** Seat order of an Ausgleichsphase: everyone maxDelta − delta times, smallest Delta first in every pass. */
export function compensationSeats(ordered: readonly string[], deltas: ReadonlyMap<string, number>): string[] {
  const delta = (u: string) => deltas.get(u) ?? 0;
  const max = Math.max(0, ...ordered.map(delta));
  const order = [...ordered].sort((a, b) => delta(a) - delta(b));
  const seats: string[] = [];
  for (let pass = 1; pass <= max; pass++) {
    for (const u of order) if (max - delta(u) >= pass) seats.push(u);
  }
  return seats;
}
