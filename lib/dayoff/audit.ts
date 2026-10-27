// [fork] Typed audit metadata for Dienstfrei events. Passed as the generic of
// logUserAction<T>()/logSystemEvent<T>() so lib/audit-log.ts's union stays untouched.
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { logSystemEvent } from "@/lib/audit-log";
import { dayOffs, type DayOff } from "@/lib/dayoff/schema";
import type { ReconcileEvent } from "@/lib/dayoff/service";
import type { DropReason, ProposalSide } from "@/lib/dayoff/types";
import { rotations } from "@/lib/rotation/schema";

export interface DayOffAuditBase {
  calendarId: string;
  calendarName: string;
  dutyDate: string;
  holderUserId: string;
}

export type DayOffMovedMetadata = DayOffAuditBase & { from: string | null; to: string };
export type DayOffLockedMetadata = DayOffAuditBase & { note: string | null };
export type DayOffProposedMetadata = DayOffAuditBase & { dates: string[] };
export type DayOffCounteredMetadata = DayOffAuditBase & { date: string };
export type DayOffAcceptedMetadata = DayOffAuditBase & { date: string; side: ProposalSide };
export type DayOffDeclinedMetadata = DayOffAuditBase & { date: string; side: ProposalSide; reason: string | null };
/** dayoff.reset / dayoff.dropped, written by reconcile; the system is the actor. */
export type DayOffSystemMetadata = DayOffAuditBase & { kind: "reset" | "dropped"; reason?: DropReason };

export function dayOffAuditBase(row: DayOff): DayOffAuditBase {
  const cal = db
    .select({ calendarId: calendars.id, calendarName: calendars.name })
    .from(rotations)
    .innerJoin(calendars, eq(calendars.id, rotations.calendarId))
    .where(eq(rotations.id, row.rotationId))
    .get();
  return {
    calendarId: cal?.calendarId ?? "",
    calendarName: cal?.calendarName ?? "",
    dutyDate: row.dutyDate,
    holderUserId: row.userId,
  };
}

/** Logs the resets and drops of a reconcile run. Call after the transaction committed. */
export async function logReconcileEvents(events: ReconcileEvent[]): Promise<void> {
  if (events.length === 0) return;
  const rows = db.select().from(dayOffs).where(inArray(dayOffs.id, [...new Set(events.map((e) => e.dayOffId))])).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const event of events) {
    const row = byId.get(event.dayOffId);
    if (!row) continue;
    await logSystemEvent<DayOffSystemMetadata>({
      action: `dayoff.${event.kind}`,
      userId: null,
      resourceType: "day_off",
      resourceId: row.id,
      metadata: { ...dayOffAuditBase(row), kind: event.kind, ...(event.reason ? { reason: event.reason } : {}) },
    });
  }
}

const logFailed = (error: unknown) => console.error("[DayOff] Failed to log reconcile events:", error);

/** Fire-and-forget wrapper for callers that must not wait on the audit log. */
export function logReconcileEventsLater(events: ReconcileEvent[]): void {
  if (events.length > 0) void logReconcileEvents(events).catch(logFailed);
}
