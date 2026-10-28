// [fork] Typed audit metadata for Urlaub events. Passed as the generic of
// logUserAction<T>()/logSystemEvent<T>() so lib/audit-log.ts's union stays untouched.
import type { VacationNotificationKind } from "@/lib/vacation/types";

export interface VacationNotificationFailedMetadata {
  kind: VacationNotificationKind;
  vacationId: string;
  attempts: number;
  message: string;
}
