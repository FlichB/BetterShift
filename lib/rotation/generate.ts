import { fromDayNumber, isoWeekday, mondayOf, toDayNumber } from "@/lib/rotation/dates";
import type { PlannedDuty, RotationRule } from "@/lib/rotation/types";

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
function roundCost(groups: string[][], firstDuty: number, history: History, idealGap: number): number {
  const lastDuty = new Map<string, number>();
  const lastGroup = new Map<string, string[]>();
  const pairs = new Map<string, PairStat>();
  const served = new Map<string, number>();
  let cost = 0;

  groups.forEach((group, j) => {
    const t = firstDuty + j;
    for (const u of group) {
      const prev = lastDuty.get(u) ?? history.lastDuty.get(u);
      if (prev === undefined) continue;
      if (t - prev <= 1) cost += BACK_TO_BACK;
      const count = served.get(u) ?? (history.served.get(u) as number);
      const drift = Math.abs(t - (history.firstDuty.get(u) as number) - count * idealGap);
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
function improveRound(groups: string[][], price: (g: string[][]) => number): string[][] {
  let best = price(groups);
  for (let step = 0; step < MAX_IMPROVEMENTS && best > 0; step++) {
    let bestMove: (() => void) | null = null;

    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const [ga, gb] = [groups[a], groups[b]];
        for (let i = 0; i < ga.length; i++) {
          for (let j = 0; j < gb.length; j++) {
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
 * Teilnehmer per duty, in duty order. The duties come in rounds in which
 * every Teilnehmer serves equally often (once per round when n is a multiple
 * of perShift). The first round is plain round robin from startOffset; every
 * later round is rearranged so that nobody serves two duties in a row, nobody
 * keeps the partner of their previous duty, and the gaps stay even.
 */
export function* dutyGroups(rule: RotationRule): Generator<string[]> {
  const n = rule.memberIds.length;
  const k = rule.perShift;
  const ordered = Array.from({ length: n }, (_, i) => rule.memberIds[(rule.startOffset + i) % n]);
  const position = new Map(rule.memberIds.map((id, i) => [id, i]));
  const byPosition = (a: string, b: string) => (position.get(a) as number) - (position.get(b) as number);
  const dutiesPerRound = n / gcd(n, k);
  const idealGap = n / k;
  const history: History = {
    firstDuty: new Map(),
    served: new Map(),
    lastDuty: new Map(),
    lastGroup: new Map(),
    pairs: new Map(),
  };

  for (let round = 0, duty = 0; ; round++) {
    let groups = Array.from({ length: dutiesPerRound }, (_, j) =>
      Array.from({ length: k }, (_, s) => ordered[(j * k + s) % n])
    );
    if (round > 0) {
      const firstDuty = duty;
      groups = improveRound(groups, (g) => roundCost(g, firstDuty, history, idealGap));
    }

    for (const group of groups) {
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

/**
 * Planned duties for every duty day in [from, to] on or after rule.startDate.
 * Duties are counted from startDate so the result for a date never
 * depends on the requested window; a period whose duty days are all
 * Ausfalltage does not consume a number.
 */
export function generateDuties(rule: RotationRule, from: string, to: string): PlannedDuty[] {
  assertRule(rule);
  const start = toDayNumber(rule.startDate);
  const first = Math.max(start, toDayNumber(from));
  const last = toDayNumber(to);
  const skip = new Set(rule.skipDates);
  const weekdays = new Set(rule.weekdays);

  const result: PlannedDuty[] = [];
  const groups = dutyGroups(rule);
  let userIds: string[] = [];
  let currentPeriod: number | null = null;

  for (let day = start; day <= last; day++) {
    if (weekdays.size > 0 && !weekdays.has(isoWeekday(day))) continue;
    const date = fromDayNumber(day);
    if (skip.has(date)) continue;

    const period = periodIndex(rule, start, day);
    if (period !== currentPeriod) {
      currentPeriod = period;
      userIds = groups.next().value as string[];
    }
    if (day >= first) result.push({ date, userIds });
  }
  return result;
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
