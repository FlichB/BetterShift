import { getShiftSignupPermission, getUserAccessibleCalendars } from "@/lib/auth/permissions";

/** Spec B1: any signed-in user holding signUpSelf in the calendar (signups switched on). */
export async function canUseSwaps(userId: string | null | undefined, calendarId: string): Promise<boolean> {
  if (!userId) return false;
  return (await getShiftSignupPermission(userId, calendarId)).canManageOwn;
}

export async function swapCalendarIds(userId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const calendar of await getUserAccessibleCalendars(userId)) {
    if (await canUseSwaps(userId, calendar.id)) ids.push(calendar.id);
  }
  return ids;
}
