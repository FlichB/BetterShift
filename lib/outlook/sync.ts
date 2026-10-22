// [fork] Reconciles office@ events with the duties of Outlook-enabled rotations (spec 12.25).
// Local fingerprints decide what changed, so Graph is only called for real differences —
// including holder changes made through upstream signup routes, which fork code never sees.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { shiftSignups, shifts, user } from "@/lib/db/schema";
import { formatDateToLocal } from "@/lib/date-utils";
import type { OutlookSyncFailedMetadata } from "@/lib/outlook/audit";
import { desiredEvent, dutyStartsAt, fingerprint, type DesiredEvent, type DutyForSync } from "@/lib/outlook/desired";
import { GraphError, type GraphClient } from "@/lib/outlook/graph-client";
import { outlookEvents, type OutlookEvent } from "@/lib/outlook/schema";
import { hasStarted } from "@/lib/rotation/dates";
import { rotationDuties, rotations } from "@/lib/rotation/schema";

export const MAX_CALLS_PER_RUN = 50;
const BACKOFF_MINUTES = [1, 5, 15, 60];
const MINUTE_MS = 60_000;

/** Wait before the next attempt; attempts counts failures so far (>= 1). */
export function backoffMs(attempts: number): number {
  return BACKOFF_MINUTES[Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1] * MINUTE_MS;
}

export type SyncFailure = OutlookSyncFailedMetadata;

export interface SyncOptions {
  bodyHtml: string;
  cancelComment: string;
  rotationId?: string;
  limit?: number;
}

export interface SyncResult {
  created: number;
  updated: number;
  cancelled: number;
  failures: SyncFailure[];
  authError: string | null;
  remaining: number;
}

type UpsertJob = { kind: "upsert"; duty: DutyForSync; event: DesiredEvent; fp: string; row: OutlookEvent | undefined };
type CancelJob = { kind: "cancel"; row: OutlookEvent };
type Job = UpsertJob | CancelJob;

/** Not-yet-begun duties of Outlook-enabled rotations with their holders' addresses. */
export function loadDesiredDuties(now: Date, rotationId?: string): DutyForSync[] {
  const enabled = eq(rotations.outlookEnabled, true);
  const rows = db
    .select({
      shiftId: rotationDuties.shiftId,
      rotationId: rotationDuties.rotationId,
      date: rotationDuties.date,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      isAllDay: shifts.isAllDay,
      title: shifts.title,
    })
    .from(rotationDuties)
    .innerJoin(rotations, eq(rotations.id, rotationDuties.rotationId))
    .innerJoin(shifts, eq(shifts.id, rotationDuties.shiftId))
    .where(rotationId ? and(enabled, eq(rotations.id, rotationId)) : enabled)
    .all()
    .filter((d) => !hasStarted(d.date, d.startTime, now))
    // Earliest first: with the per-run limit, the nearest duties are synced first.
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  if (rows.length === 0) return [];

  const holders = db
    .select({ shiftId: shiftSignups.shiftId, email: user.email, name: user.name })
    .from(shiftSignups)
    .innerJoin(user, eq(user.id, shiftSignups.userId))
    .where(inArray(shiftSignups.shiftId, rows.map((r) => r.shiftId)))
    .all();
  return rows.map((r) => ({
    ...r,
    isAllDay: Boolean(r.isAllDay),
    holders: holders.filter((h) => h.shiftId === r.shiftId).map(({ email, name }) => ({ email, name })),
  }));
}

function markSynced(shiftId: string, values: Partial<OutlookEvent>, now: Date): void {
  db.update(outlookEvents)
    .set({ ...values, state: "active", transactionId: null, syncedAt: now, attempts: 0, nextAttemptAt: null, lastError: null })
    .where(eq(outlookEvents.shiftId, shiftId))
    .run();
}

async function upsert(client: GraphClient, job: UpsertJob, now: Date, bodyHtml: string, result: SyncResult): Promise<void> {
  const { duty, event, fp, row } = job;
  const startsAt = dutyStartsAt(duty.date, duty.startTime);
  const input = { ...event, bodyHtml };

  // A cancelled event of a duty that is wanted again starts over with a fresh event.
  const eventId = row?.state === "active" ? row.eventId : null;
  if (eventId) {
    try {
      await client.updateEvent(eventId, input);
      markSynced(duty.shiftId, { eventId, fingerprint: fp, startsAt, rotationId: duty.rotationId }, now);
      result.updated++;
      return;
    } catch (error) {
      if (!(error instanceof GraphError && error.isNotFound)) throw error;
      // Deleted in office@: fall through and create it again.
    }
  }

  // Reuse the id of a create still in flight; anything else gets a new one.
  const pending = row?.state === "active" && !row.eventId ? row.transactionId : null;
  const transactionId = pending ?? crypto.randomUUID();
  const values = { rotationId: duty.rotationId, startsAt, transactionId, state: "active" as const, eventId: null, fingerprint: null };
  db.insert(outlookEvents)
    .values({ shiftId: duty.shiftId, ...values })
    .onConflictDoUpdate({ target: outlookEvents.shiftId, set: values })
    .run();
  const created = await client.createEvent(input, transactionId);
  markSynced(duty.shiftId, { eventId: created.id, icalUid: created.iCalUId, fingerprint: fp, startsAt }, now);
  result.created++;
}

async function cancel(client: GraphClient, row: OutlookEvent, now: Date, comment: string, result: SyncResult): Promise<void> {
  if (row.eventId) {
    try {
      await client.cancelEvent(row.eventId, comment);
    } catch (error) {
      if (!(error instanceof GraphError && error.isNotFound)) throw error;
    }
  }
  db.update(outlookEvents)
    .set({ state: "cancelled", transactionId: null, syncedAt: now, attempts: 0, nextAttemptAt: null, lastError: null })
    .where(eq(outlookEvents.shiftId, row.shiftId))
    .run();
  result.cancelled++;
}

/** Stores the failure on the row; returns it when this is the duty's first failure in a row. */
function recordFailure(job: Job, error: unknown, now: Date): SyncFailure | null {
  const shiftId = job.kind === "upsert" ? job.duty.shiftId : job.row.shiftId;
  const current = db.select().from(outlookEvents).where(eq(outlookEvents.shiftId, shiftId)).get();
  if (!current) return null; // upsert inserts the row before calling Graph, cancel works on an existing row
  const attempts = current.attempts + 1;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const wait = error instanceof GraphError && error.retryAfterMs !== null ? error.retryAfterMs : backoffMs(attempts);
  db.update(outlookEvents)
    .set({ attempts, nextAttemptAt: new Date(now.getTime() + wait), lastError: message })
    .where(eq(outlookEvents.shiftId, shiftId))
    .run();
  if (attempts > 1) return null;
  const date = job.kind === "upsert" ? job.duty.date : formatDateToLocal(current.startsAt);
  return { rotationId: current.rotationId, shiftId, date, message };
}

export async function syncOutlook(client: GraphClient, now: Date, options: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, cancelled: 0, failures: [], authError: null, remaining: 0 };
  const duties = loadDesiredDuties(now, options.rotationId);
  const rows = new Map(
    db
      .select()
      .from(outlookEvents)
      .where(options.rotationId ? eq(outlookEvents.rotationId, options.rotationId) : undefined)
      .all()
      .map((r) => [r.shiftId, r])
  );

  const jobs: Job[] = [];
  const desiredIds = new Set<string>();
  for (const duty of duties) {
    desiredIds.add(duty.shiftId);
    const event = desiredEvent(duty);
    const fp = fingerprint(event);
    const row = rows.get(duty.shiftId);
    if (row?.state === "active" && row.eventId && row.fingerprint === fp) continue;
    jobs.push({ kind: "upsert", duty, event, fp, row });
  }
  for (const row of rows.values()) {
    if (row.state !== "active" || desiredIds.has(row.shiftId)) continue;
    if (row.startsAt.getTime() <= now.getTime()) continue; // begun duties are never touched
    jobs.push({ kind: "cancel", row });
  }

  const due = jobs.filter((job) => !job.row?.nextAttemptAt || job.row.nextAttemptAt.getTime() <= now.getTime());
  const limit = options.limit ?? MAX_CALLS_PER_RUN;
  result.remaining = Math.max(0, due.length - limit);

  for (const job of due.slice(0, limit)) {
    try {
      if (job.kind === "upsert") await upsert(client, job, now, options.bodyHtml, result);
      else await cancel(client, job.row, now, options.cancelComment, result);
    } catch (error) {
      if (error instanceof GraphError && error.isAuth) {
        result.authError = error.message;
        return result;
      }
      const failure = recordFailure(job, error, now);
      if (failure) result.failures.push(failure);
    }
  }
  return result;
}

/** "Jetzt abgleichen": duties waiting for their backoff become due immediately. */
export function resetBackoff(rotationId: string): void {
  db.update(outlookEvents).set({ nextAttemptAt: null }).where(eq(outlookEvents.rotationId, rotationId)).run();
}
