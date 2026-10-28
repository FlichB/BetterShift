import { fromDayNumber, isoWeekday, mondayOf, toDayNumber } from "@/lib/rotation/dates";
import type { PlannedDays, PlannedDuty, RotationRule } from "@/lib/rotation/types";
import { compensationSeats, yearDeltaRows, type YearDeltaRow, type YearTally } from "@/lib/rotation/yearly";

function assertRule(rule: RotationRule): void {
  if (!Number.isInteger(rule.perShift) || rule.perShift < 1) {
    throw new RangeError("perShift must be a positive integer");
  }
  if (rule.memberIds.length < rule.perShift) {
    throw new RangeError("A rotation needs at least perShift members");
  }
  if (rule.period === "days" && (!Number.isInteger(rule.periodDays) || (rule.periodDays ?? 0) < 1)) {
    throw new RangeError("period 'days' needs a positive periodDays");
  }
  // An unknown weekday would leave the endless periods() stream without a Diensttag forever.
  if (!rule.weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) {
    throw new RangeError("weekdays must be integers 1-7");
  }
  if (!rule.reinforcedDates.every((r) => Number.isInteger(r.perShift) && r.perShift >= 1)) {
    throw new RangeError("reinforcedDates perShift must be a positive integer");
  }
}

function periodIndex(rule: RotationRule, start: number, day: number): number {
  switch (rule.period) {
    case "day":
      return day - start;
    case "week":
      return Math.floor((mondayOf(day) - mondayOf(start)) / 7);
    case "days":
      return Math.floor((day - start) / (rule.periodDays as number));
  }
}

// Cost weights of a round, in order of priority: nobody on two duties in a
// row, nobody with the same partner as on their previous duty, pairs rotate
// through everyone, each Teilnehmer stays on their even n / perShift beat so
// counts over any quarter differ by as little as possible.
const BACK_TO_BACK = 1_000_000;
const SAME_PARTNER = 10_000;
const PAIR_RECENT = 200;
const PAIR_COUNT = 300;
const DRIFT = 60;
const DRIFT_LIMIT = 2;
const OFF_BEAT = 50_000;
const MAX_IMPROVEMENTS = 200;
// [fork] Jahresausgleich: per Teilnehmer still owed a seat when someone owed fewer starts serving.
const OWED_FIRST = 1_000;

interface PairStat {
  count: number;
  last: number;
}

interface History {
  /** Position (pos) of each Teilnehmer's first duty and how many they had since: the anchor of their beat. */
  firstPos: Map<string, number>;
  served: Map<string, number>;
  lastDuty: Map<string, number>;
  lastGroup: Map<string, string[]>;
  pairs: Map<string, PairStat>;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const pairKey = (u: string, v: string) => (u < v ? `${u}\u0000${v}` : `${v}\u0000${u}`);

/** Walks a round as it would continue the history and prices it. */
function roundCost(
  groups: string[][],
  duties: number[],
  history: History,
  idealGap: number,
  pos: (duty: number) => number,
  withDrift = true,
  anchorNew = false,
  beatless?: ReadonlySet<string> // [fork] Urlaub: beat restarts at their next duty, priced without drift
): number {
  const lastDuty = new Map<string, number>();
  const lastGroup = new Map<string, string[]>();
  const pairs = new Map<string, PairStat>();
  const served = new Map<string, number>();
  // [fork] Jahresausgleich (anchorNew): a Teilnehmer who never served before this round starts
  // their beat at their first duty in it, instead of pricing their second duty as NaN. Off on
  // the plain path, whose output must stay as it is.
  const firstPos = new Map<string, number>();
  let cost = 0;

  groups.forEach((group, j) => {
    const t = duties[j];
    for (const u of group) {
      const prev = lastDuty.get(u) ?? history.lastDuty.get(u);
      if (prev === undefined) {
        if (withDrift && anchorNew) {
          firstPos.set(u, pos(t));
          served.set(u, 1);
        }
        continue;
      }
      if (t - prev <= 1) cost += BACK_TO_BACK;
      if (withDrift && !beatless?.has(u)) {
        const count = served.get(u) ?? (history.served.get(u) as number);
        const anchor = firstPos.get(u) ?? (history.firstPos.get(u) as number);
        const drift = Math.abs(pos(t) - anchor - count * idealGap);
        cost += DRIFT * drift ** 2 + (drift > DRIFT_LIMIT ? OFF_BEAT : 0);
        served.set(u, count + 1);
      }
      const before = lastGroup.get(u) ?? history.lastGroup.get(u);
      if (before && group.some((v) => v !== u && before.includes(v))) cost += SAME_PARTNER;
    }
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        const key = pairKey(group[a], group[b]);
        const stat = pairs.get(key) ?? history.pairs.get(key);
        const count = stat?.count ?? 0;
        cost += PAIR_COUNT * count;
        if (stat) cost += PAIR_RECENT / (t - stat.last);
        pairs.set(key, { count: count + 1, last: t });
      }
    }
    for (const u of group) {
      lastDuty.set(u, t);
      lastGroup.set(u, group);
    }
  });
  return cost;
}

/**
 * [fork] Jahresausgleich: keeps the Ausgleichsphase first. Prices each Teilnehmer's first seat in
 * the round by how many people owed more compensation seats have not served yet.
 */
function owedFirstCost(groups: string[][], owed: ReadonlyMap<string, number>): number {
  const served = new Set<string>();
  let cost = 0;
  for (const group of groups) {
    for (const u of group) {
      if (served.has(u)) continue;
      const mine = owed.get(u) ?? 0;
      for (const [v, theirs] of owed) if (theirs > mine && !served.has(v) && !group.includes(v)) cost += OWED_FIRST;
    }
    for (const u of group) served.add(u);
  }
  return cost;
}

/** Deterministic best-improvement search over seat swaps and duty order. */
function improveRound(
  groups: string[][],
  fixed: number[],
  movable: boolean[],
  price: (g: string[][]) => number,
  allowed?: (u: string, j: number) => boolean // [fork] Urlaub: j = index into groups
): string[][] {
  let best = price(groups);
  for (let step = 0; step < MAX_IMPROVEMENTS && best > 0; step++) {
    let bestMove: (() => void) | null = null;

    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const [ga, gb] = [groups[a], groups[b]];
        for (let i = fixed[a]; i < ga.length; i++) {
          for (let j = fixed[b]; j < gb.length; j++) {
            const [x, y] = [ga[i], gb[j]];
            if (x === y || ga.includes(y) || gb.includes(x)) continue;
            if (allowed && (!allowed(y, a) || !allowed(x, b))) continue; // [fork] Urlaub is a hard rule
            ga[i] = y;
            gb[j] = x;
            const cost = price(groups);
            ga[i] = x;
            gb[j] = y;
            if (cost < best) {
              best = cost;
              bestMove = () => {
                ga[i] = y;
                gb[j] = x;
              };
            }
          }
        }
        if (!movable[a] || !movable[b] || ga.length !== gb.length) continue;
        if (allowed && (!gb.every((u) => allowed(u, a)) || !ga.every((u) => allowed(u, b)))) continue; // [fork] Urlaub
        groups[a] = gb;
        groups[b] = ga;
        const cost = price(groups);
        groups[a] = ga;
        groups[b] = gb;
        if (cost < best) {
          best = cost;
          bestMove = () => {
            groups[a] = gb;
            groups[b] = ga;
          };
        }
      }
    }

    if (!bestMove) break;
    bestMove();
  }
  return groups;
}

/**
 * Hard rule: nobody twice in one duty. A duty straddling two rounds can draw the same person
 * from both; swap the second seat with a free seat elsewhere in the round that fits both duties.
 * The fallback (no such seat) takes the first Teilnehmer not yet in the duty.
 */
function repairDuplicates(groups: string[][], fixed: number[], memberIds: string[]): void {
  for (let g = 0; g < groups.length; g++) {
    for (let i = fixed[g]; i < groups[g].length; i++) {
      const x = groups[g][i];
      if (groups[g].indexOf(x) === i) continue;
      let swapped = false;
      for (let h = 0; h < groups.length && !swapped; h++) {
        if (h === g) continue;
        for (let j = fixed[h]; j < groups[h].length; j++) {
          const y = groups[h][j];
          if (groups[g].includes(y) || groups[h].includes(x)) continue;
          groups[g][i] = y;
          groups[h][j] = x;
          swapped = true;
          break;
        }
      }
      if (!swapped) groups[g][i] = memberIds.find((id) => !groups[g].includes(id)) as string;
    }
  }
}

/** [fork] Jahresausgleich (SPEC 12.41): lets dutyGroups cut rounds at year ends and settle Deltas. */
export interface YearlyHooks {
  /** Calendar year of a duty: the year of its first Diensttag. */
  yearOf: (duty: number) => number;
  /** Delta per Teilnehmer that `year` settles; `duty` is its first duty, `planned` every earlier duty's group. */
  deltasAt: (year: number, duty: number, planned: readonly string[][]) => ReadonlyMap<string, number>;
}

/** [fork] Urlaub (SPEC 12.43): who may sit in a duty, and the year a duty belongs to (Nachhol-Konten reset at New Year). */
export interface AbsenceHooks {
  allowed: (userId: string, duty: number) => boolean;
  yearOf: (duty: number) => number;
}

/** [fork] Urlaub: orders by Nachhol-Konto (dir 1 = lowest first), then member order. */
const byBalance =
  (balance: ReadonlyMap<string, number>, position: ReadonlyMap<string, number>, dir: 1 | -1) => (a: string, b: string) =>
    dir * ((balance.get(a) ?? 0) - (balance.get(b) ?? 0)) || (position.get(a) as number) - (position.get(b) as number);

/** [fork] Urlaub: Nachhol-Konten of one calendar year (userId → balance), created on first use. */
type Konten = (year: number) => Map<string, number>;

/**
 * [fork] Urlaub: per calendar year of the round's duties, each debtor of that year takes one Platz
 * of a creditor of the same year on a duty of that year, where allowed. True if a seat changed.
 */
function makeUp(
  groups: string[][],
  fixed: number[],
  duties: number[],
  absence: AbsenceHooks,
  konten: Konten,
  position: ReadonlyMap<string, number>,
  beatless: Set<string>
): boolean {
  let changed = false;
  for (const year of new Set(duties.map((d) => absence.yearOf(d)))) {
    if (makeUpIn(year, groups, fixed, duties, absence, konten(year), position, beatless)) changed = true;
  }
  return changed;
}

function makeUpIn(
  year: number,
  groups: string[][],
  fixed: number[],
  duties: number[],
  absence: AbsenceHooks,
  balance: Map<string, number>,
  position: ReadonlyMap<string, number>,
  beatless: Set<string>
): boolean {
  let changed = false;
  const debtors = [...balance.keys()].filter((u) => (balance.get(u) ?? 0) < 0).sort(byBalance(balance, position, 1));
  for (const u of debtors) {
    const creditors = [...balance.keys()].filter((v) => (balance.get(v) ?? 0) > 0).sort(byBalance(balance, position, -1));
    let done = false;
    for (const v of creditors) {
      for (let j = 0; j < groups.length && !done; j++) {
        if (absence.yearOf(duties[j]) !== year) continue; // a Nachholplatz stays in its calendar year
        if (groups[j].includes(u) || !absence.allowed(u, duties[j])) continue;
        const i = groups[j].indexOf(v);
        if (i < fixed[j]) continue; // not seated here, or a carried seat
        groups[j][i] = u;
        balance.set(u, (balance.get(u) ?? 0) + 1);
        balance.set(v, (balance.get(v) ?? 0) - 1);
        beatless.add(u);
        done = true;
        changed = true;
      }
      if (done) break;
    }
  }
  return changed;
}

/** [fork] Urlaub: no seat on a blocked duty: swap within the round, else a substitute, else leave the Platz open. True if a seat changed. */
function repairAbsences(
  groups: string[][],
  fixed: number[],
  duties: number[],
  absence: AbsenceHooks,
  konten: Konten,
  position: ReadonlyMap<string, number>,
  memberIds: string[]
): boolean {
  let changed = false;
  for (let j = 0; j < groups.length; j++) {
    const balance = konten(absence.yearOf(duties[j])); // booked in the calendar year of the repaired duty
    for (let i = fixed[j]; i < groups[j].length; i++) {
      const u = groups[j][i];
      if (absence.allowed(u, duties[j])) continue;
      changed = true;
      let swapped = false;
      for (let h = 0; h < groups.length && !swapped; h++) {
        if (h === j || !absence.allowed(u, duties[h]) || groups[h].includes(u)) continue;
        for (let k = fixed[h]; k < groups[h].length; k++) {
          const y = groups[h][k];
          if (groups[j].includes(y) || !absence.allowed(y, duties[j])) continue;
          groups[j][i] = y;
          groups[h][k] = u;
          swapped = true;
          break;
        }
      }
      if (swapped) continue;
      const substitute = memberIds
        .filter((id) => !groups[j].includes(id) && absence.allowed(id, duties[j]))
        .sort(byBalance(balance, position, 1))[0];
      balance.set(u, (balance.get(u) ?? 0) - 1);
      if (substitute) {
        groups[j][i] = substitute;
        balance.set(substitute, (balance.get(substitute) ?? 0) + 1);
      } else {
        groups[j].splice(i, 1);
        i--;
      }
    }
  }
  return changed;
}

/**
 * Teilnehmer per duty, in duty order. Seats come in rounds of lcm(n, perShift) in which every
 * Teilnehmer appears equally often; each duty draws sizeOf(duty) seats (capped at n, at least
 * perShift), so a duty of a Verstärkter Tag may straddle two rounds. The first round is plain
 * round robin from startOffset; every later round is rearranged so that nobody serves two duties
 * in a row, nobody keeps the partner of their previous duty, and the gaps stay even. With every
 * duty at perShift this is exactly the former duty-round generator. With yearly hooks, rounds end
 * at the last duty of a year and a year starts with an Ausgleichsphase (SPEC 12.41). With absence
 * hooks, nobody sits on a duty touching their Urlaub; missed Plätze are made up within the
 * calendar year (SPEC 12.43).
 */
export function* dutyGroups(
  rule: RotationRule,
  sizeOf: (duty: number) => number = () => rule.perShift,
  yearly?: YearlyHooks,
  absence?: AbsenceHooks // [fork] Urlaub
): Generator<string[]> {
  const n = rule.memberIds.length;
  const k = rule.perShift;
  const ordered = Array.from({ length: n }, (_, i) => rule.memberIds[(rule.startOffset + i) % n]);
  const position = new Map(rule.memberIds.map((id, i) => [id, i]));
  const byPosition = (a: string, b: string) => (position.get(a) as number) - (position.get(b) as number);
  const seatsPerRound = (n * k) / gcd(n, k);
  const idealGap = n / k;
  const capacity = (duty: number) => Math.min(n, Math.max(k, sizeOf(duty)));
  // Seats drawn before a duty, in units of perShift seats: pos(t) === t while every duty has perShift seats.
  const seatsBefore = [0];
  const pos = (duty: number) => {
    while (seatsBefore.length <= duty) {
      const d = seatsBefore.length - 1;
      seatsBefore.push(seatsBefore[d] + capacity(d));
    }
    return seatsBefore[duty] / k;
  };
  const history: History = {
    firstPos: new Map(),
    served: new Map(),
    lastDuty: new Map(),
    lastGroup: new Map(),
    pairs: new Map(),
  };

  let duty = 0;
  let carry: string[] = []; // seats of `duty` already drawn in the previous round

  // [fork] Jahresausgleich state (yearly mode only).
  const planned: string[][] = []; // every yielded group, by duty
  const yearCount = new Map<string, number>(); // Plätze in the current year
  let yearDelta: ReadonlyMap<string, number> = new Map(); // Delta the current year settles

  // [fork] Urlaub: Nachhol-Konto per calendar year and Teilnehmer (-1 = owes a Platz); a new year
  // starts at 0. beatless = beat restarts at next duty.
  const balances = new Map<number, Map<string, number>>();
  const konten: Konten = (year) => {
    let map = balances.get(year);
    if (!map) balances.set(year, (map = new Map()));
    return map;
  };
  const beatless = new Set<string>();

  /**
   * [fork] Seats of a yearly round in drawing order, `total` of them. A round gives everyone
   * (total - extra) / n seats plus their compensation seats (`extra`). The last round of a year
   * (`tail`) takes every seat left in the year instead: they go one by one to whoever has the fewest
   * Plätze + Delta this year, then the fewest Plätze, so the year stays even without a short round
   * of whoever happens to come first. A plain round is passes in order of longest wait; an
   * Ausgleichsphase or tail is laid out duty by duty (see below) for improveRound to polish.
   */
  const yearlySeats = (extra: readonly string[], total: number, tail: boolean): string[] => {
    // A seat already drawn for the first duty (carry) counts as serving now.
    const last = (u: string) => (carry.includes(u) ? duty : (history.lastDuty.get(u) ?? -1));
    const rank = [...ordered].sort((a, b) => last(a) - last(b));
    const need = new Map(rank.map((u) => [u, extra.filter((v) => v === u).length]));
    if (!tail) {
      for (const u of rank) need.set(u, (need.get(u) as number) + (total - extra.length) / n);
    } else {
      const seatsOf = (u: string) => (yearCount.get(u) ?? 0) + (carry.includes(u) ? 1 : 0) + (need.get(u) as number);
      for (let rest = total - extra.length; rest > 0; rest--) {
        let pick = rank[0];
        for (const u of rank) {
          const better =
            seatsOf(u) + (yearDelta.get(u) ?? 0) - (seatsOf(pick) + (yearDelta.get(pick) ?? 0)) || seatsOf(u) - seatsOf(pick);
          if (better < 0) pick = u;
        }
        need.set(pick, (need.get(pick) as number) + 1);
      }
    }
    if (extra.length === 0 && !tail) {
      // Plain passes, longest wait first.
      return Array.from({ length: total / n }, () => rank).flat();
    }
    // Off-beat round: lay it out duty by duty. Each seat goes to whoever did not serve the duty
    // before, then does not meet their previous partner, then has the most seats left (so those
    // owed seats come first and nobody is left over at the end), then has waited longest.
    const left = new Map(need);
    const lastAt = new Map(rank.map((u) => [u, last(u)]));
    const lastGroup = new Map(rank.map((u) => [u, history.lastGroup.get(u) ?? []]));
    const seats: string[] = [];
    let remaining = total;
    for (let d = duty; remaining > 0; d++) {
      const group = d === duty ? [...carry] : [];
      const slots = Math.min(capacity(d) - group.length, remaining);
      for (let s = 0; s < slots; s++) {
        const score = (u: string) => [
          (lastAt.get(u) as number) >= d - 1 ? 1 : 0,
          group.some((v) => (lastGroup.get(u) as string[]).includes(v)) ? 1 : 0,
          -(left.get(u) as number),
          lastAt.get(u) as number,
        ];
        let best: string | null = null;
        let bestScore: number[] = [];
        for (const u of rank) {
          if ((left.get(u) as number) === 0 || group.includes(u)) continue;
          const sc = score(u);
          const i = sc.findIndex((x, j) => x !== bestScore[j]);
          if (best === null || (i >= 0 && sc[i] < bestScore[i])) [best, bestScore] = [u, sc];
        }
        // Only people already in this duty are owed seats: repairDuplicates swaps one out.
        best ??= rank.find((u) => (left.get(u) as number) > 0) as string;
        group.push(best);
        seats.push(best);
        left.set(best, (left.get(best) as number) - 1);
        remaining--;
      }
      for (const u of group) {
        lastAt.set(u, d);
        lastGroup.set(u, group);
      }
    }
    return seats;
  };

  for (let round = 0; ; round++) {
    let groups: string[][] = [];
    const duties: number[] = [];
    const fixed: number[] = [];
    const complete: boolean[] = [];
    const roundStart = duty;

    // [fork] Jahresausgleich: the first round of a year settles the Deltas of the year before.
    // Ausgleichsphase and the last round of a year are priced without the beat and restart it.
    let offBeat = false;
    let owed: ReadonlyMap<string, number> | null = null; // compensation seats per person in an Ausgleichsphase
    if (yearly) {
      const sameYear = (d: number) => d === roundStart || yearly.yearOf(d) === yearly.yearOf(roundStart);
      let extra: string[] = [];
      if (duty === 0 || yearly.yearOf(duty) !== yearly.yearOf(duty - 1)) {
        yearCount.clear();
        yearDelta = carry.length === 0 ? yearly.deltasAt(yearly.yearOf(duty), duty, planned) : new Map();
        extra = compensationSeats(ordered, yearDelta);
      }
      // The Ausgleichsphase is merged into the two rounds after it, so a compensation seat always
      // finds room away from the same person's other seats. When what is left of the year after
      // this round would not make a full round, this round takes the rest of the year.
      const rounds = extra.length > 0 ? 2 : 1;
      const limit = (rounds + 1) * seatsPerRound + extra.length;
      let left = 0;
      for (let d = duty; left < limit && sameYear(d); d++) left += capacity(d) - (d === duty ? carry.length : 0);
      const tail = left < limit;
      offBeat = extra.length > 0 || tail;
      if (extra.length > 0) owed = new Map(ordered.map((u) => [u, extra.filter((v) => v === u).length]));
      const pool = yearlySeats(extra, tail ? left : rounds * seatsPerRound + extra.length, tail);
      for (let d = duty, seat = 0; seat < pool.length && sameYear(d); d++) {
        const held = d === duty ? carry : [];
        const take = Math.min(capacity(d) - held.length, pool.length - seat);
        groups.push([...held, ...pool.slice(seat, seat + take)]);
        duties.push(d);
        fixed.push(held.length);
        // A short last duty is finished by the next round, like a duty straddling two rounds.
        complete.push(held.length + take === capacity(d));
        seat += take;
      }
    } else {
      for (let d = duty, seat = 0; seat < seatsPerRound; d++) {
        const held = d === duty ? carry : [];
        const take = Math.min(capacity(d) - held.length, seatsPerRound - seat);
        groups.push([...held, ...Array.from({ length: take }, (_, s) => ordered[(seat + s) % n])]);
        duties.push(d);
        fixed.push(held.length);
        complete.push(held.length + take === capacity(d));
        seat += take;
      }
    }
    repairDuplicates(groups, fixed, rule.memberIds);
    let touched = false; // [fork] Urlaub: did an absence or a Nachholplatz change this round?
    if (absence) {
      // [fork] Urlaub (SPEC 12.43)
      // No duty of a year before the round's first duty can come up again.
      for (const year of balances.keys()) if (year < absence.yearOf(duty)) balances.delete(year);
      touched = makeUp(groups, fixed, duties, absence, konten, position, beatless);
      touched = repairAbsences(groups, fixed, duties, absence, konten, position, rule.memberIds) || touched;
    }
    if (round > 0 || offBeat || touched) {
      // [fork] Urlaub: a duty left with an open Platz keeps its place.
      const movable = groups.map((g, j) => fixed[j] === 0 && complete[j] && g.length === capacity(duties[j]));
      const settle = owed;
      const allowedAt = absence ? (u: string, j: number) => absence.allowed(u, duties[j]) : undefined; // [fork] Urlaub
      groups = improveRound(
        groups,
        fixed,
        movable,
        (g) =>
          roundCost(g, duties, history, idealGap, pos, !offBeat, yearly !== undefined, beatless) +
          (settle ? owedFirstCost(g, settle) : 0),
        allowedAt
      );
    }

    carry = [];
    for (let j = 0; j < groups.length; j++) {
      const group = groups[j];
      if (!complete[j]) {
        carry = group; // finished by the next round
        break;
      }
      for (let a = 0; a < group.length; a++) {
        for (let b = a + 1; b < group.length; b++) {
          const key = pairKey(group[a], group[b]);
          const stat = history.pairs.get(key);
          history.pairs.set(key, { count: (stat?.count ?? 0) + 1, last: duty });
        }
      }
      for (const u of group) {
        if (beatless.delete(u)) {
          // [fork] Urlaub: restart the beat after an absence or a Nachholplatz
          history.firstPos.set(u, pos(duty));
          history.served.set(u, 0);
        }
        if (!history.firstPos.has(u)) history.firstPos.set(u, pos(duty));
        history.served.set(u, (history.served.get(u) ?? 0) + 1);
        history.lastDuty.set(u, duty);
        history.lastGroup.set(u, group);
      }
      if (absence) for (const u of rule.memberIds) if (!absence.allowed(u, duty)) beatless.add(u); // [fork] Urlaub
      duty++;
      const sorted = [...group].sort(byPosition);
      if (yearly) {
        for (const u of group) yearCount.set(u, (yearCount.get(u) ?? 0) + 1);
        planned.push([...sorted]);
      }
      yield sorted;
    }
    if (offBeat) {
      // Everyone restarts their beat after an off-beat round, so sitting out is not drift. The new
      // beats are spread evenly like a first round robin (longest wait first, perShift per duty);
      // anchoring each at their own last duty would keep those who served together in step.
      const next = [...history.lastDuty].sort((x, y) => x[1] - y[1]).map(([u]) => u);
      next.forEach((u, i) => {
        history.firstPos.set(u, pos(duty) + i / k - idealGap);
        history.served.set(u, 1);
      });
    }
  }
}

interface Period {
  /** Open Diensttage of the period (Schließtage left out). */
  dates: string[];
  /** Plätze of its duty: perShift, or the largest Verstärkter Tag inside it. */
  size: number;
}

/** Every period from startDate on that has at least one open Diensttag; endless. */
function* periods(rule: RotationRule): Generator<Period> {
  const start = toDayNumber(rule.startDate);
  const closed = new Set(rule.closedDates.map((c) => c.date));
  const reinforced = new Map(rule.reinforcedDates.map((r) => [r.date, r.perShift]));
  const weekdays = new Set(rule.weekdays);
  let current: Period | null = null;
  let currentIndex: number | null = null;
  for (let day = start; ; day++) {
    if (weekdays.size > 0 && !weekdays.has(isoWeekday(day))) continue;
    const date = fromDayNumber(day);
    if (closed.has(date)) continue;
    const index = periodIndex(rule, start, day);
    if (index !== currentIndex) {
      if (current) yield current;
      current = { dates: [], size: rule.perShift };
      currentIndex = index;
    }
    current!.dates.push(date);
    current!.size = Math.max(current!.size, reinforced.get(date) ?? 0);
  }
}

const yearOfDate = (date: string) => Number(date.slice(0, 4));

/** The period stream and the duty groups for it; with yearlyFairness the groups settle Deltas. */
function planner(rule: RotationRule) {
  const stream = periods(rule);
  const seen: Period[] = [];
  const periodAt = (i: number): Period => {
    while (seen.length <= i) seen.push(stream.next().value as Period);
    return seen[i];
  };
  const yearly: YearlyHooks | undefined = rule.yearlyFairness
    ? {
        yearOf: (duty) => yearOfDate(periodAt(duty).dates[0]),
        deltasAt: (year, duty, planned) => {
          // A restart inside a year must not settle the year before a second time.
          if (duty === 0 && tallyYear(rule, periodAt, [], year).firstDate !== null) return new Map();
          const rows = yearDeltaRows(rule.memberIds, rule.memberSince, tallyYear(rule, periodAt, planned, year - 1), rule.deltaOverrides?.[year]);
          return new Map((rows ?? []).map((r) => [r.userId, r.delta]));
        },
      }
    : undefined;
  // [fork] Urlaub (SPEC 12.43)
  const ranges = new Map<string, { from: string; to: string }[]>();
  for (const a of rule.absences ?? []) ranges.set(a.userId, [...(ranges.get(a.userId) ?? []), a]);
  const absence: AbsenceHooks | undefined =
    ranges.size > 0
      ? {
          allowed: (u, duty) => !(ranges.get(u) ?? []).some((r) => periodAt(duty).dates.some((d) => r.from <= d && d <= r.to)),
          yearOf: (duty) => yearOfDate(periodAt(duty).dates[0]),
        }
      : undefined;
  return { periodAt, groups: dutyGroups(rule, (d) => periodAt(d).size, yearly, absence) };
}

/**
 * Plätze per person in `year`: the planned duties of that year (a date's real holders from
 * heldDuties win; a period with several dates counts 1 / dates per date) and held dates before
 * startDate, which belong to an earlier configuration.
 */
function tallyYear(rule: RotationRule, periodAt: (i: number) => Period, planned: readonly string[][], year: number): YearTally {
  const counts = new Map<string, number>();
  const add = (u: string, w: number) => counts.set(u, (counts.get(u) ?? 0) + w);
  let firstDate: string | null = null;
  const held = rule.heldDuties ?? {};
  for (const [date, holders] of Object.entries(held)) {
    if (date >= rule.startDate || yearOfDate(date) !== year) continue;
    if (firstDate === null || date < firstDate) firstDate = date;
    for (const u of holders) add(u, 1);
  }
  planned.forEach((group, i) => {
    const { dates } = periodAt(i);
    if (yearOfDate(dates[0]) !== year) return;
    if (firstDate === null || dates[0] < firstDate) firstDate = dates[0];
    for (const date of dates) for (const u of held[date] ?? group) add(u, 1 / dates.length);
  });
  return { counts, firstDate };
}

/**
 * [fork] Jahresausgleich: the Delta rows that `year` settles. Null when nothing was counted in
 * year − 1, or when the rotation restarts inside `year` after held dates of it (nothing settles).
 */
export function yearSummary(rule: RotationRule, year: number): YearDeltaRow[] | null {
  assertRule(rule);
  const { periodAt, groups } = planner(rule);
  // Same guard as deltasAt: a restart inside `year` does not settle the year before again.
  if (yearOfDate(periodAt(0).dates[0]) === year && tallyYear(rule, periodAt, [], year).firstDate !== null) return null;
  const planned: string[][] = [];
  for (let i = 0; periodAt(i).dates[0] < `${year}-01-01`; i++) planned.push(groups.next().value as string[]);
  return yearDeltaRows(rule.memberIds, rule.memberSince, tallyYear(rule, periodAt, planned, year - 1), rule.deltaOverrides?.[year]);
}

/**
 * Duties and Schließtage for every Diensttag in [from, to] on or after rule.startDate.
 * Duties are counted from startDate so the result for a date never depends on the requested
 * window; a Schließtag does not consume a duty, a period whose Diensttage are all closed does not
 * consume a number, and a Verstärkter Tag draws more seats (its capacity).
 * Ausfalltage on other weekdays only add a Schließeintrag.
 */
export function generateDays(rule: RotationRule, from: string, to: string): PlannedDays {
  assertRule(rule);
  const start = toDayNumber(rule.startDate);
  const first = Math.max(start, toDayNumber(from));
  const last = toDayNumber(to);
  const n = rule.memberIds.length;
  const open = new Map(rule.openHolidays.map((h) => [h.date, h.name]));
  const weekdays = new Set(rule.weekdays);

  const { periodAt, groups } = planner(rule);

  const duties: PlannedDuty[] = [];
  for (let i = 0; toDayNumber(periodAt(i).dates[0]) <= last; i++) {
    const period = periodAt(i);
    const userIds = groups.next().value as string[];
    const capacity = Math.min(n, period.size);
    for (const date of period.dates) {
      const day = toDayNumber(date);
      if (day < first || day > last) continue;
      const openHoliday = open.get(date);
      duties.push(openHoliday ? { date, userIds, capacity, openHoliday } : { date, userIds, capacity });
    }
  }
  const closures = rule.closedDates
    .filter((c) => {
      const day = toDayNumber(c.date);
      return day >= first && day <= last && (c.source === "skip" || weekdays.size === 0 || weekdays.has(isoWeekday(day))); // [fork] SPEC 12.35
    })
    .map((c) => ({ ...c }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { duties, closures };
}

/** Only the duties of generateDays(). */
export function generateDuties(rule: RotationRule, from: string, to: string): PlannedDuty[] {
  return generateDays(rule, from, to).duties;
}

/**
 * startOffset for a restart: the Teilnehmer right after the latest position
 * (in the new order) among those who had the last duty before the restart,
 * moved on until nobody of that duty is in the first one after the restart.
 */
export function suggestStartOffset(memberIds: string[], lastDutyUserIds: string[], perShift = 1): number {
  const n = memberIds.length;
  const positions = lastDutyUserIds
    .map((id) => memberIds.indexOf(id))
    .filter((p) => p >= 0);
  if (positions.length === 0 || n === 0) return 0;
  const after = (Math.max(...positions) + 1) % n;
  for (let step = 0; step < n; step++) {
    const offset = (after + step) % n;
    const first = Array.from({ length: Math.min(perShift, n) }, (_, s) => memberIds[(offset + s) % n]);
    if (!first.some((id) => lastDutyUserIds.includes(id))) return offset;
  }
  return after;
}
