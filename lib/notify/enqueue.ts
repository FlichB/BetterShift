// [fork] Writes notification events into the outbox inside the caller's transaction (spec 12.27):
// a mail is queued exactly when the swap action commits. Recipients are resolved at send time.
import type { db } from "@/lib/db";
import { isOutlookConfigured } from "@/lib/outlook/config";
import { notificationOutbox, type NotificationKind } from "@/lib/notify/schema";
import type { ShiftSwap } from "@/lib/swap/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function offerKind(swap: Pick<ShiftSwap, "targetUserId">): NotificationKind {
  return swap.targetUserId ? "offer_to_me" : "offer_to_all";
}

export function enqueueSwapEvent(tx: Tx, kind: NotificationKind, swap: ShiftSwap, actorUserId: string | null, now: Date): void {
  if (!isOutlookConfigured()) return;
  tx.insert(notificationOutbox).values({ kind, swapId: swap.id, actorUserId, createdAt: now }).run();
}
