// [fork] Typed audit metadata for swap events. Passed as the generic of
// logUserAction<T>()/logSystemEvent<T>() so lib/audit-log.ts's union stays untouched.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars, shifts } from "@/lib/db/schema";
import { logSystemEvent } from "@/lib/audit-log";
import { formatDateToLocal } from "@/lib/date-utils";
import type { ShiftSwap } from "@/lib/swap/schema";
import type { SlotMove } from "@/lib/swap/rules";
import type { SwapType } from "@/lib/swap/types";

export interface SwapAuditBase {
  calendarId: string;
  calendarName: string;
  type: SwapType;
  offeredDate: string;
  offeredByUserId: string;
}

export type SwapOfferedMetadata = SwapAuditBase & { targetUserId: string | null; requestedDate: string | null };
export type SwapAcceptedMetadata = SwapAuditBase & {
  acceptedByUserId: string;
  acceptedDate: string | null;
  moves: SlotMove[];
};
/** declined, withdrawn, expired, cancelled */
export type SwapResolvedMetadata = SwapAuditBase;

export function shiftDate(shiftId: string | null): string | null {
  if (!shiftId) return null;
  const row = db.select({ date: shifts.date }).from(shifts).where(eq(shifts.id, shiftId)).get();
  return row ? formatDateToLocal(row.date) : null;
}

export function swapAuditBase(swap: ShiftSwap): SwapAuditBase {
  const row = db
    .select({ calendarId: calendars.id, calendarName: calendars.name, date: shifts.date })
    .from(shifts)
    .innerJoin(calendars, eq(calendars.id, shifts.calendarId))
    .where(eq(shifts.id, swap.offeredShiftId))
    .get();
  return {
    calendarId: row?.calendarId ?? "",
    calendarName: row?.calendarName ?? "",
    type: swap.type,
    offeredDate: row ? formatDateToLocal(row.date) : "",
    offeredByUserId: swap.offeredByUserId,
  };
}

/** Logs offers that ended by themselves; the system is the actor. */
export async function logResolved(items: { swap: ShiftSwap; status: "expired" | "cancelled" }[]): Promise<void> {
  for (const { swap, status } of items) {
    await logSystemEvent<SwapResolvedMetadata>({
      action: `swap.${status}`,
      userId: null,
      resourceType: "shift_swap",
      resourceId: swap.id,
      metadata: swapAuditBase(swap),
    });
  }
}
