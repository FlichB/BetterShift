import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import type { User } from "@/lib/auth";
import { getCalendarAccess } from "@/lib/auth/permissions";
import { siteAdminCanEditCalendar } from "@/lib/auth/admin";

/** Owner, holders of manageCalendarSettings on the calendar, or site admins (spec 12.12). */
export async function canManageRotations(
  userId: string | null | undefined,
  calendarId: string
): Promise<boolean> {
  const access = await getCalendarAccess(userId, calendarId);
  if (access && (access.isOwner || access.can("manageCalendarSettings"))) return true;
  if (!userId) return false;
  const row = db.select().from(userTable).where(eq(userTable.id, userId)).get();
  return siteAdminCanEditCalendar(row as unknown as User | undefined);
}
