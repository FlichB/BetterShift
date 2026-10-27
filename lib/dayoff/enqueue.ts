// [fork] Dienstfrei: writes notification events into the outbox inside the caller's transaction,
// like enqueueSwapEvent. Recipients are resolved at send time.
import { dayOffOutbox } from "@/lib/dayoff/schema";
import type { DayOffAudience, DayOffNotificationKind } from "@/lib/dayoff/types";
import type { Tx } from "@/lib/dayoff/workdays";
import { isOutlookConfigured } from "@/lib/outlook/config";

export function enqueueDayOff(
  tx: Tx,
  kind: DayOffNotificationKind,
  dayOffId: string,
  audience: DayOffAudience,
  actorUserId: string | null,
  now: Date,
  proposalId: string | null = null
): void {
  if (!isOutlookConfigured()) return;
  tx.insert(dayOffOutbox).values({ kind, dayOffId, proposalId, audience, actorUserId, createdAt: now }).run();
}
