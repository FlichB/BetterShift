// [fork] Typed audit metadata for Urlaub events. Passed as the generic of
// logUserAction<T>()/logSystemEvent<T>() so lib/audit-log.ts's union stays untouched.
import { logUserAction } from "@/lib/audit-log";
import type { VacationNotificationKind } from "@/lib/vacation/types";

export interface VacationNotificationFailedMetadata {
  kind: VacationNotificationKind;
  vacationId: string;
  attempts: number;
  message: string;
}

export type VacationAuditAction =
  | "vacation.requested"
  | "vacation.approved"
  | "vacation.rejected"
  | "vacation.withdrawn"
  | "vacation.entered"
  | "vacation.changed"
  | "vacation.cancelled"
  | "vacation.change_requested"
  | "vacation.change_approved"
  | "vacation.change_rejected"
  | "vacation.change_withdrawn";

export interface VacationAuditMetadata {
  vacationId: string;
  holderUserId: string;
  startDate: string;
  endDate: string;
  previousStart?: string;
  previousEnd?: string;
  changeKind?: "change" | "cancel";
  note?: string | null;
}

/** Audit entry for a vacation action; `vacation` is the row after the action. */
export async function logVacationAction(
  action: VacationAuditAction,
  actorId: string,
  vacation: { id: string; userId: string; startDate: string; endDate: string },
  request: Request,
  extra: Partial<VacationAuditMetadata> = {}
): Promise<void> {
  await logUserAction<VacationAuditMetadata>({
    action,
    userId: actorId,
    resourceType: "vacation",
    resourceId: vacation.id,
    metadata: { vacationId: vacation.id, holderUserId: vacation.userId, startDate: vacation.startDate, endDate: vacation.endDate, ...extra },
    request,
  });
}
