// [fork] Outlook switch and sync status of one rotation, for the rotations page (spec 12.24).
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { formatDateToLocal } from "@/lib/date-utils";
import { isOutlookConfigured } from "@/lib/outlook/config";
import { fingerprint } from "@/lib/outlook/desired";
import { outlookEvents } from "@/lib/outlook/schema";
import { loadDesiredPlaces } from "@/lib/outlook/sync";
import { rotations } from "@/lib/rotation/schema";

export interface OutlookStatus {
  configured: boolean;
  enabled: boolean;
  total: number;
  synced: number;
  failed: number;
  pending: number;
  lastSyncedAt: string | null;
  errors: { shiftId: string; date: string; message: string }[];
}

const MAX_ERRORS = 20;

export function setOutlookEnabled(rotationId: string, enabled: boolean): boolean {
  const updated = db
    .update(rotations)
    .set({ outlookEnabled: enabled, updatedAt: new Date() })
    .where(eq(rotations.id, rotationId))
    .returning({ id: rotations.id })
    .all();
  return updated.length > 0;
}

export function outlookStatus(rotationId: string, enabled: boolean, now: Date): OutlookStatus {
  const places = enabled ? loadDesiredPlaces(now, rotationId) : [];
  const rows = db.select().from(outlookEvents).where(eq(outlookEvents.rotationId, rotationId)).all();
  const byKey = new Map(rows.map((r) => [r.eventKey, r]));

  let synced = 0;
  for (const place of places) {
    const row = byKey.get(place.key);
    if (row?.state === "active" && row.eventId && !row.lastError && row.fingerprint === fingerprint(place.event)) synced++;
  }
  const failing = rows
    .filter((r) => r.lastError && r.startsAt.getTime() > now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  // One line per duty: the panel keys by shiftId and both Plätze of a duty usually fail together.
  const failingDuties = failing.filter((r, i) => failing.findIndex((o) => o.shiftId === r.shiftId) === i);
  const last = rows.reduce<Date | null>((max, r) => (r.syncedAt && (!max || r.syncedAt > max) ? r.syncedAt : max), null);

  return {
    configured: isOutlookConfigured(),
    enabled,
    total: places.length,
    synced,
    failed: failing.length,
    pending: Math.max(0, places.length - synced - failing.length),
    lastSyncedAt: last?.toISOString() ?? null,
    errors: failingDuties.slice(0, MAX_ERRORS).map((r) => ({ shiftId: r.shiftId, date: formatDateToLocal(r.startsAt), message: r.lastError! })),
  };
}
