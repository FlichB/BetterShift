// [fork] Urlaub: writes mail events into the outbox inside the caller's transaction, like enqueueDayOff.
import type { Tx } from "@/lib/rotation/service";
import { isOutlookConfigured } from "@/lib/outlook/config";
import { vacationOutbox } from "@/lib/vacation/schema";
import type { VacationNotificationKind } from "@/lib/vacation/types";

export function enqueueVacation(
  tx: Tx,
  kind: VacationNotificationKind,
  vacationId: string,
  actorUserId: string | null,
  now: Date,
  extra: { changeId?: string; previousStart?: string; previousEnd?: string } = {}
): void {
  if (!isOutlookConfigured()) return;
  tx.insert(vacationOutbox)
    .values({ kind, vacationId, actorUserId, createdAt: now, changeId: extra.changeId ?? null, previousStart: extra.previousStart ?? null, previousEnd: extra.previousEnd ?? null })
    .run();
}
