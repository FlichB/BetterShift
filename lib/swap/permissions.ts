import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { getCalendarAccess, getShiftSignupPermission, getUserAccessibleCalendars } from "@/lib/auth/permissions";

/** Spec B1: any signed-in user holding signUpSelf in the calendar (signups switched on). */
export async function canUseSwaps(userId: string | null | undefined, calendarId: string): Promise<boolean> {
  if (!userId) return false;
  return (await getShiftSignupPermission(userId, calendarId)).canManageOwn;
}

/**
 * Same rule as canUseSwaps, but for a user OTHER than the requester (direct-request targets,
 * member lists). The requester's share-link cookie is ignored: it describes the requester's
 * access, not the other user's, and would otherwise make every user id pass.
 */
export async function canOtherUserSwap(userId: string, calendarId: string): Promise<boolean> {
  const access = await getCalendarAccess(userId, calendarId, { ignoreTokenCookie: true });
  if (!access) return false;
  const calendar = db.select({ signupsEnabled: calendars.signupsEnabled }).from(calendars).where(eq(calendars.id, calendarId)).get();
  if (!calendar?.signupsEnabled) return false;
  return access.isOwner || access.can("signUpSelf");
}

export async function swapCalendarIds(userId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const calendar of await getUserAccessibleCalendars(userId)) {
    if (await canUseSwaps(userId, calendar.id)) ids.push(calendar.id);
  }
  return ids;
}
