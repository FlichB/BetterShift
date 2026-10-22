// [fork] Typed audit metadata for rotation events. Passed as the generic of
// logUserAction<T>() so lib/audit-log.ts's union stays untouched.
export interface RotationAuditBase {
  rotationName: string;
  calendarId: string;
  calendarName: string;
}

export type RotationCreatedMetadata = RotationAuditBase & { memberCount: number; perShift: number };
export type RotationUpdatedMetadata = RotationAuditBase & { memberCount: number; startDate: string };
export type RotationDeletedMetadata = RotationAuditBase & { deletedDuties: number };
export type RotationGeneratedMetadata = RotationAuditBase & {
  from: string;
  to: string;
  created: number;
  updated: number;
  deleted: number;
};
export type RotationLockRemovedMetadata = RotationAuditBase & { shiftId: string; userId: string };
