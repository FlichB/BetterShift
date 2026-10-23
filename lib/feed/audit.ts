// [fork] Typed audit metadata for the personal feed link. Passed as the generic of
// logUserAction<T>() so lib/audit-log.ts's union stays untouched.
export interface PersonalFeedTokenMetadata {
  rotated: boolean;
}
