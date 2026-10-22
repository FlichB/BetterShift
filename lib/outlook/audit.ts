// [fork] Typed audit metadata for Outlook sync and notification events. Passed as the generic of
// logUserAction<T>()/logSystemEvent<T>() so lib/audit-log.ts's union stays untouched.
export interface OutlookToggleMetadata {
  rotationName: string;
  calendarId: string;
  calendarName: string;
}

/** One duty whose event could not be synced; logged on the first failure only. */
export interface OutlookSyncFailedMetadata {
  rotationId: string;
  shiftId: string;
  date: string;
  message: string;
}

export interface OutlookAuthFailedMetadata {
  message: string;
  pausedMinutes: number;
}

export interface NotificationFailedMetadata {
  kind: string;
  swapId: string;
  message: string;
}
