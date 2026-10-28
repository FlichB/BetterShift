// [fork] Who receives a Dienstfrei mail, decided at send time (permissions are async).
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendarShares, calendars, user } from "@/lib/db/schema";
import type { DayOff } from "@/lib/dayoff/schema";
import type { DayOffAudience } from "@/lib/dayoff/types";
import { getPreferences } from "@/lib/notify/preferences";
import type { Recipient } from "@/lib/notify/recipients";
import { canManageRotations } from "@/lib/rotation/permissions";

/** Owner and share users of a calendar who may manage its rotations. */
async function managerIds(calendarId: string): Promise<string[]> {
  const owner = db.select({ id: calendars.ownerId }).from(calendars).where(eq(calendars.id, calendarId)).get();
  const shared = db.select({ id: calendarShares.userId }).from(calendarShares).where(eq(calendarShares.calendarId, calendarId)).all();
  const ids = new Set([owner?.id, ...shared.map((r) => r.id)].filter((id): id is string => Boolean(id)));
  const managers: string[] = [];
  for (const id of ids) if (await canManageRotations(id, calendarId)) managers.push(id);
  return managers;
}

export async function resolveDayOffRecipients(
  audience: DayOffAudience,
  row: DayOff,
  calendarId: string,
  actorUserId: string | null
): Promise<Recipient[]> {
  const pref = audience === "holder" ? "myDayOffs" : "dayOffRequests";
  const ids = (audience === "holder" ? [row.userId] : await managerIds(calendarId)).filter((id) => id !== actorUserId);
  if (ids.length === 0) return [];
  return db
    .select({ id: user.id, email: user.email, name: user.name, banned: user.banned })
    .from(user)
    .where(inArray(user.id, ids))
    .all()
    .filter((u) => !u.banned && u.email && getPreferences(u.id)[pref])
    .map(({ id, email, name }) => ({ id, email, name }));
}
