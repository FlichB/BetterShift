// [fork] Urlaub: preview and replanning of every rotation of a person (SPEC 12.43 points 3–5, 7; design §4).
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars, user } from "@/lib/db/schema";
import { formatDateToLocal } from "@/lib/date-utils";
import { logReconcileEventsLater } from "@/lib/dayoff/audit";
import { reconcileRotation, type ReconcileEvent } from "@/lib/dayoff/service";
import { addDays } from "@/lib/rotation/dates";
import {
  applyPlan,
  planEnd,
  planInTx,
  prepareGeneration,
  rotationsOfMember,
  type PreparedGeneration,
  type Tx,
  type VacationOverride,
} from "@/lib/rotation/service";
import { approvedRanges, type Reader } from "@/lib/vacation/dates";
import { vacationChanges, vacations } from "@/lib/vacation/schema";
import type { DateRange, VacationAction, VacationPreview } from "@/lib/vacation/types";
import { VacationServiceError } from "@/lib/vacation/errors";

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** The user, their approved ranges after the action, and the first date that can change. */
export function resolveAction(reader: Reader, action: VacationAction, today: string): { userId: string; override: VacationOverride; changedFrom: string } {
  const tomorrow = addDays(today, 1);
  const without = (userId: string, id: string | null): DateRange[] => {
    const own = reader.select({ id: vacations.id, from: vacations.startDate, to: vacations.endDate }).from(vacations).where(eq(vacations.userId, userId)).all();
    const approved = approvedRanges(reader, [userId]).get(userId) ?? [];
    const skip = own.find((v) => v.id === id);
    return approved.filter((r) => !(skip && r.from === skip.from && r.to === skip.to));
  };
  const load = (id: string) => {
    const row = reader.select().from(vacations).where(eq(vacations.id, id)).get();
    if (!row) throw new VacationServiceError("notFound");
    return row;
  };
  const result = (userId: string, ranges: DateRange[], from: string) => ({
    userId,
    override: { userId, ranges: ranges.sort((a, b) => a.from.localeCompare(b.from)) },
    changedFrom: later(from, tomorrow),
  });

  switch (action.kind) {
    case "enter":
      return result(action.userId, [...without(action.userId, null), { from: action.startDate, to: action.endDate }], action.startDate);
    case "approve": {
      const v = load(action.vacationId);
      return result(v.userId, [...without(v.userId, v.id), { from: v.startDate, to: v.endDate }], v.startDate);
    }
    case "change": {
      const v = load(action.vacationId);
      return result(v.userId, [...without(v.userId, v.id), { from: action.startDate, to: action.endDate }], earlier(v.startDate, action.startDate));
    }
    case "cancel": {
      const v = load(action.vacationId);
      return result(v.userId, without(v.userId, v.id), v.startDate);
    }
    case "approveChange": {
      const c = reader.select().from(vacationChanges).where(eq(vacationChanges.id, action.changeId)).get();
      if (!c) throw new VacationServiceError("notFound");
      const v = load(c.vacationId);
      if (c.kind === "cancel") return result(v.userId, without(v.userId, v.id), v.startDate);
      return result(v.userId, [...without(v.userId, v.id), { from: c.startDate!, to: c.endDate! }], earlier(v.startDate, c.startDate!));
    }
  }
}

const names = (ids: string[]) => {
  if (ids.length === 0) return new Map<string, string>();
  return new Map(db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids)).all().map((u) => [u.id, u.name]));
};

/** Whether the rotation has written duties from `changedFrom` on, i.e. anything to replan. */
const reaches = (reader: Reader, rotationId: string, changedFrom: string): boolean => {
  const to = planEnd(reader, rotationId);
  return to !== null && changedFrom <= to;
};

/**
 * Templates of the rotations that have something to replan. A rotation planned only up to before
 * `changedFrom` is not prepared, so its preset or sign-up settings cannot block the vacation.
 */
async function prepareReaching(rotationIds: string[], changedFrom: string): Promise<Map<string, PreparedGeneration>> {
  const ids = rotationIds.filter((id) => reaches(db, id, changedFrom));
  return new Map(await Promise.all(ids.map(async (id) => [id, await prepareGeneration(id)] as const)));
}

/** What each rotation of the person would change; nothing is written. */
export async function previewAction(action: VacationAction, now: Date): Promise<VacationPreview> {
  const today = formatDateToLocal(now);
  const { userId, override, changedFrom } = resolveAction(db, action, today);
  const list = rotationsOfMember(db, userId);
  const prepared = await prepareReaching(list.map((r) => r.id), changedFrom);
  const calendarNames = new Map(db.select({ id: calendars.id, name: calendars.name }).from(calendars).all().map((c) => [c.id, c.name]));
  const rotations = db.transaction((tx) =>
    list.map((r) => {
      const to = planEnd(tx, r.id);
      const p = prepared.get(r.id);
      const plan = p && to && changedFrom <= to ? planInTx(tx, p, changedFrom, to, now, override) : null;
      const entries = (plan?.entries ?? []).filter((e) => e.kind === "update" && (e.add.length > 0 || e.remove.length > 0));
      const people = names([...new Set(entries.flatMap((e) => (e.kind === "update" ? [...e.userIds, ...e.remove] : [])))]);
      return {
        rotationId: r.id,
        rotationName: r.name,
        calendarName: calendarNames.get(r.calendarId) ?? "",
        changes: entries.map((e) => {
          if (e.kind !== "update") throw new Error("unreachable");
          const before = [...e.userIds.filter((u) => !e.add.includes(u)), ...e.remove];
          return { date: e.date, before: before.map((u) => people.get(u) ?? "?"), after: e.userIds.map((u) => people.get(u) ?? "?") };
        }),
        warnings: plan?.warnings ?? [],
      };
    })
  );
  return { rotations };
}

/** Runs `write` and regenerates every rotation of the user from `changedFrom` to its Planende, all in one transaction. */
export async function runWithReplan<T>(userId: string, changedFrom: string, actorId: string, now: Date, write: (tx: Tx) => T): Promise<T> {
  const list = rotationsOfMember(db, userId);
  const prepared = await prepareReaching(list.map((r) => r.id), changedFrom);
  let events: ReconcileEvent[] = [];
  const result = db.transaction((tx) => {
    const value = write(tx);
    for (const r of list) {
      const p = prepared.get(r.id);
      const to = planEnd(tx, r.id);
      if (!p || !to || changedFrom > to) {
        // Nothing to replan; the Dienstfreie still move off the new vacation days.
        events = [...events, ...reconcileRotation(tx, r.id, now).events];
        continue;
      }
      const applied = applyPlan(tx, p, planInTx(tx, p, changedFrom, to, now), actorId, now);
      events = [...events, ...applied.dayOffEvents];
    }
    return value;
  });
  logReconcileEventsLater(events);
  return result;
}
