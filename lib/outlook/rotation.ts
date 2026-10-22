// [fork] Outlook switch and sync status of one rotation, for the rotations page (spec 12.24).
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { formatDateToLocal } from "@/lib/date-utils";
import { isOutlookConfigured } from "@/lib/outlook/config";
import { desiredEvent, fingerprint } from "@/lib/outlook/desired";
import { outlookEvents } from "@/lib/outlook/schema";
import { loadDesiredDuties } from "@/lib/outlook/sync";
import { rotations } from "@/lib/rotation/schema";

export interface OutlookStatus {
  configured: boolean;
  enabled: boolean;
  total: number;
  synced: number;
  failed: number;
  pending: number;
  lastSyncedAt: string | null;
  errors: { date: string; message: string }[];
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
  const duties = enabled ? loadDesiredDuties(now, rotationId) : [];
  const rows = db.select().from(outlookEvents).where(eq(outlookEvents.rotationId, rotationId)).all();
  const byShift = new Map(rows.map((r) => [r.shiftId, r]));

  let synced = 0;
  for (const duty of duties) {
    const row = byShift.get(duty.shiftId);
    if (row?.state === "active" && row.eventId && !row.lastError && row.fingerprint === fingerprint(desiredEvent(duty))) synced++;
  }
  const failing = rows
    .filter((r) => r.lastError && r.startsAt.getTime() > now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const last = rows.reduce<Date | null>((max, r) => (r.syncedAt && (!max || r.syncedAt > max) ? r.syncedAt : max), null);

  return {
    configured: isOutlookConfigured(),
    enabled,
    total: duties.length,
    synced,
    failed: failing.length,
    pending: Math.max(0, duties.length - synced - failing.length),
    lastSyncedAt: last?.toISOString() ?? null,
    errors: failing.slice(0, MAX_ERRORS).map((r) => ({ date: formatDateToLocal(r.startsAt), message: r.lastError! })),
  };
}
