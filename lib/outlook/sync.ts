// [fork] Reconciles office@ events with the duties of Outlook-enabled rotations (spec 12.25).
// Local fingerprints decide what changed, so Graph is only called for real differences —
// including holder changes made through upstream signup routes, which fork code never sees.
// One event per Platz (spec 12.32); a swap is one cancel plus one create.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { shiftSignups, shifts, user } from "@/lib/db/schema";
import { formatDateToLocal } from "@/lib/date-utils";
import type { OutlookSyncFailedMetadata } from "@/lib/outlook/audit";
import { desiredEvents, dutyStartsAt, fingerprint, type DesiredEvent, type DutyForSync, type PlaceEvent } from "@/lib/outlook/desired";
import { GraphError, type GraphClient, type GraphEvent } from "@/lib/outlook/graph-client";
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
  renderBody: (event: DesiredEvent) => string;
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

type UpsertJob = { kind: "upsert"; place: PlaceEvent; fp: string; row: OutlookEvent | undefined };
type CancelJob = { kind: "cancel"; row: OutlookEvent };
type Job = UpsertJob | CancelJob;

/** Not-yet-begun duties of Outlook-enabled rotations with their holders' addresses. */
export function loadDesiredDuties(now: Date, rotationId?: string): DutyForSync[] {
  const enabled = eq(rotations.outlookEnabled, true);
  const rows = db
    .select({
      shiftId: rotationDuties.shiftId,
      rotationId: rotationDuties.rotationId,
      kind: rotationDuties.kind,
      date: rotationDuties.date,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      isAllDay: shifts.isAllDay,
      title: shifts.title,
      entryTitle: rotations.entryTitle,
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
    .select({ shiftId: shiftSignups.shiftId, userId: shiftSignups.userId, email: user.email, name: user.name })
    .from(shiftSignups)
    .innerJoin(user, eq(user.id, shiftSignups.userId))
    .where(inArray(shiftSignups.shiftId, rows.map((r) => r.shiftId)))
    .all();
  return rows.map((r) => ({
    ...r,
    isAllDay: Boolean(r.isAllDay),
    holders: holders.filter((h) => h.shiftId === r.shiftId).map(({ userId, email, name }) => ({ userId, email, name })),
  }));
}

/** Every office@ event the enabled rotations want, nearest first. */
export function loadDesiredPlaces(now: Date, rotationId?: string): PlaceEvent[] {
  return loadDesiredDuties(now, rotationId).flatMap(desiredEvents);
}

function markSynced(key: string, values: Partial<OutlookEvent>, now: Date): void {
  db.update(outlookEvents)
    .set({ ...values, state: "active", transactionId: null, syncedAt: now, attempts: 0, nextAttemptAt: null, lastError: null })
    .where(eq(outlookEvents.eventKey, key))
    .run();
}

async function upsert(client: GraphClient, job: UpsertJob, now: Date, renderBody: SyncOptions["renderBody"], result: SyncResult): Promise<void> {
  const { place, fp, row } = job;
  const { event } = place;
  const startsAt = dutyStartsAt(place.date, place.startTime);
  const input = { ...event, bodyHtml: renderBody(event) };

  // A cancelled event of a duty that is wanted again starts over with a fresh event.
  const eventId = row?.state === "active" ? row.eventId : null;
  if (eventId) {
    try {
      await client.updateEvent(eventId, input);
      markSynced(place.key, { eventId, fingerprint: fp, startsAt, rotationId: place.rotationId }, now);
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
  const values = { rotationId: place.rotationId, startsAt, transactionId, state: "active" as const, eventId: null, fingerprint: null };
  db.insert(outlookEvents)
    .values({ eventKey: place.key, shiftId: place.shiftId, userId: place.userId, ...values })
    .onConflictDoUpdate({ target: outlookEvents.eventKey, set: values })
    .run();
  const created = await client.createEvent(input, transactionId);
  // A reused id may have returned an earlier event with old content: leave the fingerprint empty so the next run patches it.
  markSynced(place.key, { eventId: created.id, icalUid: created.iCalUId, fingerprint: pending ? null : fp, startsAt }, now);
  result.created++;
}

async function cancel(client: GraphClient, row: OutlookEvent, now: Date, comment: string, result: SyncResult): Promise<void> {
  // A create whose response was lost may still have stored the event: find it by its transaction id.
  const eventId = row.eventId ?? (row.transactionId ? await client.findEventByTransactionId(row.transactionId, row.startsAt) : null);
  if (eventId) {
    try {
      await client.cancelEvent(eventId, comment);
    } catch (error) {
      if (error instanceof GraphError && error.status === 400) {
        // Events without attendees are plain appointments, which cannot be cancelled: delete them.
        try {
          await client.deleteEvent(eventId);
        } catch (deleteError) {
          if (!(deleteError instanceof GraphError && deleteError.isNotFound)) throw deleteError;
        }
      } else if (!(error instanceof GraphError && error.isNotFound)) throw error;
    }
  }
  db.update(outlookEvents)
    .set({ state: "cancelled", transactionId: null, syncedAt: now, attempts: 0, nextAttemptAt: null, lastError: null })
    .where(eq(outlookEvents.eventKey, row.eventKey))
    .run();
  result.cancelled++;
}

/** Stores the failure on the row; returns it when this is the duty's first failure in a row. */
function recordFailure(job: Job, error: unknown, now: Date): SyncFailure | null {
  const key = job.kind === "upsert" ? job.place.key : job.row.eventKey;
  const current = db.select().from(outlookEvents).where(eq(outlookEvents.eventKey, key)).get();
  if (!current) return null; // upsert inserts the row before calling Graph, cancel works on an existing row
  const attempts = current.attempts + 1;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const wait = error instanceof GraphError && error.retryAfterMs !== null ? error.retryAfterMs : backoffMs(attempts);
  db.update(outlookEvents)
    .set({ attempts, nextAttemptAt: new Date(now.getTime() + wait), lastError: message })
    .where(eq(outlookEvents.eventKey, key))
    .run();
  if (attempts > 1) return null;
  const date = job.kind === "upsert" ? job.place.date : formatDateToLocal(current.startsAt);
  return { rotationId: current.rotationId, shiftId: current.shiftId, date, message };
}

export async function syncOutlook(client: GraphClient, now: Date, options: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, cancelled: 0, failures: [], authError: null, remaining: 0 };
  const places = loadDesiredPlaces(now, options.rotationId);
  const rows = new Map(
    db
      .select()
      .from(outlookEvents)
      .where(options.rotationId ? eq(outlookEvents.rotationId, options.rotationId) : undefined)
      .all()
      .map((r) => [r.eventKey, r])
  );

  const jobs: Job[] = [];
  const desiredKeys = new Set<string>();
  for (const place of places) {
    desiredKeys.add(place.key);
    const fp = fingerprint(place.event);
    const row = rows.get(place.key);
    if (row?.state === "active" && row.eventId && row.fingerprint === fp) continue;
    jobs.push({ kind: "upsert", place, fp, row });
  }
  for (const row of rows.values()) {
    if (row.state !== "active" || desiredKeys.has(row.eventKey)) continue;
    if (row.startsAt.getTime() <= now.getTime()) continue; // begun duties are never touched
    jobs.push({ kind: "cancel", row });
  }

  const due = jobs.filter((job) => !job.row?.nextAttemptAt || job.row.nextAttemptAt.getTime() <= now.getTime());
  const limit = options.limit ?? MAX_CALLS_PER_RUN;
  result.remaining = Math.max(0, due.length - limit);

  for (const job of due.slice(0, limit)) {
    try {
      if (job.kind === "upsert") await upsert(client, job, now, options.renderBody, result);
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

const toMinute = (dateTime: string) => dateTime.slice(0, 16);
const addressSet = (attendees: { address: string }[]) =>
  attendees
    .map((a) => a.address.toLowerCase())
    .sort()
    .join(",");

/** Whether office@ still shows what the duty wants (Graph adds fractional seconds to times). */
export function eventMatches(actual: GraphEvent, wanted: DesiredEvent): boolean {
  return (
    actual.subject === wanted.subject &&
    toMinute(actual.start.dateTime) === toMinute(wanted.start.dateTime) &&
    toMinute(actual.end.dateTime) === toMinute(wanted.end.dateTime) &&
    actual.isAllDay === wanted.isAllDay &&
    addressSet(actual.attendees) === addressSet(wanted.attendees)
  );
}

/**
 * Nightly full reconcile (spec 12.25): reads every synced future event and marks manual changes
 * in office@ so the next syncOutlook run repairs them.
 */
export async function verifyOutlook(
  client: GraphClient,
  now: Date,
  rotationId?: string
): Promise<{ drifted: number; authError: string | null; throttled?: boolean }> {
  const wanted = new Map(loadDesiredPlaces(now, rotationId).map((p) => [p.key, p.event]));
  const rows = db
    .select()
    .from(outlookEvents)
    .where(eq(outlookEvents.state, "active"))
    .all()
    .filter((r) => r.eventId && wanted.has(r.eventKey));

  let drifted = 0;
  for (const row of rows) {
    try {
      const actual = await client.getEvent(row.eventId!);
      if (!actual || actual.isCancelled) {
        db.update(outlookEvents)
          .set({ eventId: null, fingerprint: null, transactionId: null })
          .where(eq(outlookEvents.eventKey, row.eventKey))
          .run();
        drifted++;
      } else if (!eventMatches(actual, wanted.get(row.eventKey)!)) {
        db.update(outlookEvents).set({ fingerprint: null }).where(eq(outlookEvents.eventKey, row.eventKey)).run();
        drifted++;
      }
    } catch (error) {
      if (error instanceof GraphError && error.isAuth) return { drifted, authError: error.message };
      // Throttled: stop here and let a later tick repeat the whole verify.
      if (error instanceof GraphError && error.status === 429) return { drifted, authError: null, throttled: true };
      console.error(`[Outlook] Verifying event ${row.eventKey} failed:`, error);
    }
  }
  return { drifted, authError: null };
}
