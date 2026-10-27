// [fork] Dienstfrei: who may move their own Dienstfrei (SPEC 12.36).
import { getCalendarAccess } from "@/lib/auth/permissions";

/** Owner, or a calendarShares bundle with moveOwnDayOff. Share-link cookies and guest bundles never count. */
export async function canMoveOwnDayOff(userId: string, calendarId: string): Promise<boolean> {
  const access = await getCalendarAccess(userId, calendarId, { ignoreTokenCookie: true });
  if (!access) return false;
  if (access.isOwner) return true;
  return access.source === "share" && access.can("moveOwnDayOff");
}
