import { fromDayNumber, isoWeekday, mondayOf, toDayNumber } from "@/lib/rotation/dates";
import type { PlannedDays, PlannedDuty, RotationRule } from "@/lib/rotation/types";

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

interface PairStat {
  count: number;
  last: number;
}

interface History {
  /** Duty number of each Teilnehmer's first duty and how many they had since. */
  firstDuty: Map<string, number>;
  served: Map<string, number>;
  lastDuty: Map<string, number>;
  lastGroup: Map<string, string[]>;
  pairs: Map<string, PairStat>;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const pairKey = (u: string, v: string) => (u < v ? `${u}\u0000${v}` : `${v}\u0000${u}`);

/** Walks a round as it would continue the history and prices it. */
function roundCost(groups: string[][], duties: number[], history: History, idealGap: number, pos: (duty: number) => number): number {
  const lastDuty = new Map<string, number>();
  const lastGroup = new Map<string, string[]>();
  const pairs = new Map<string, PairStat>();
  const served = new Map<string, number>();
  let cost = 0;

  groups.forEach((group, j) => {
    const t = duties[j];
    for (const u of group) {
      const prev = lastDuty.get(u) ?? history.lastDuty.get(u);
      if (prev === undefined) continue;
      if (t - prev <= 1) cost += BACK_TO_BACK;
      const count = served.get(u) ?? (history.served.get(u) as number);
      const drift = Math.abs(pos(t) - pos(history.firstDuty.get(u) as number) - count * idealGap);
      cost += DRIFT * drift ** 2 + (drift > DRIFT_LIMIT ? OFF_BEAT : 0);
      served.set(u, count + 1);
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

/** Deterministic best-improvement search over seat swaps and duty order. */
function improveRound(groups: string[][], fixed: number[], movable: boolean[], price: (g: string[][]) => number): string[][] {
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

/**
 * Teilnehmer per duty, in duty order. Seats come in rounds of lcm(n, perShift) in which every
 * Teilnehmer appears equally often; each duty draws sizeOf(duty) seats (capped at n, at least
 * perShift), so a duty of a Verstärkter Tag may straddle two rounds. The first round is plain
 * round robin from startOffset; every later round is rearranged so that nobody serves two duties
 * in a row, nobody keeps the partner of their previous duty, and the gaps stay even. With every
 * duty at perShift this is exactly the former duty-round generator.
 */
export function* dutyGroups(rule: RotationRule, sizeOf: (duty: number) => number = () => rule.perShift): Generator<string[]> {
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
    firstDuty: new Map(),
    served: new Map(),
    lastDuty: new Map(),
    lastGroup: new Map(),
    pairs: new Map(),
  };

  let duty = 0;
  let carry: string[] = []; // seats of `duty` already drawn in the previous round
  for (let round = 0; ; round++) {
    let groups: string[][] = [];
    const duties: number[] = [];
    const fixed: number[] = [];
    const complete: boolean[] = [];
    for (let d = duty, seat = 0; seat < seatsPerRound; d++) {
      const held = d === duty ? carry : [];
      const take = Math.min(capacity(d) - held.length, seatsPerRound - seat);
      groups.push([...held, ...Array.from({ length: take }, (_, s) => ordered[(seat + s) % n])]);
      duties.push(d);
      fixed.push(held.length);
      complete.push(held.length + take === capacity(d));
      seat += take;
    }
    repairDuplicates(groups, fixed, rule.memberIds);
    if (round > 0) {
      const movable = groups.map((_, j) => fixed[j] === 0 && complete[j]);
      groups = improveRound(groups, fixed, movable, (g) => roundCost(g, duties, history, idealGap, pos));
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
        if (!history.firstDuty.has(u)) history.firstDuty.set(u, duty);
        history.served.set(u, (history.served.get(u) ?? 0) + 1);
        history.lastDuty.set(u, duty);
        history.lastGroup.set(u, group);
      }
      duty++;
      yield [...group].sort(byPosition);
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

/**
 * Duties and Schließtage for every Diensttag in [from, to] on or after rule.startDate.
 * Duties are counted from startDate so the result for a date never depends on the requested
 * window; a Schließtag does not consume a duty, a period whose Diensttage are all closed does not
 * consume a number, and a Verstärkter Tag draws more seats (its capacity).
 */
export function generateDays(rule: RotationRule, from: string, to: string): PlannedDays {
  assertRule(rule);
  const start = toDayNumber(rule.startDate);
  const first = Math.max(start, toDayNumber(from));
  const last = toDayNumber(to);
  const n = rule.memberIds.length;
  const open = new Map(rule.openHolidays.map((h) => [h.date, h.name]));
  const weekdays = new Set(rule.weekdays);

  const stream = periods(rule);
  const seen: Period[] = [];
  const periodAt = (i: number): Period => {
    while (seen.length <= i) seen.push(stream.next().value as Period);
    return seen[i];
  };
  const groups = dutyGroups(rule, (d) => periodAt(d).size);

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
      return day >= first && day <= last && (weekdays.size === 0 || weekdays.has(isoWeekday(day)));
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
