// [fork] Who receives an Urlaub mail, decided at send time (permissions are async).
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { calendarManagerIds } from "@/lib/dayoff/recipients";
import { getPreferences } from "@/lib/notify/preferences";
import type { Recipient } from "@/lib/notify/recipients";
import { managerCalendarIds } from "@/lib/vacation/permissions";
import type { Vacation } from "@/lib/vacation/schema";
import type { VacationNotificationKind } from "@/lib/vacation/types";

export function audienceOf(kind: VacationNotificationKind): "holder" | "managers" {
  return kind === "vacation_requested" || kind === "vacation_change_requested" ? "managers" : "holder";
}

export async function resolveVacationRecipients(kind: VacationNotificationKind, vacation: Vacation, actorUserId: string | null): Promise<Recipient[]> {
  const audience = audienceOf(kind);
  const pref = audience === "holder" ? "myVacations" : "vacationRequests";
  let ids: string[] = [vacation.userId];
  if (audience === "managers") {
    const all = new Set<string>();
    for (const calendarId of managerCalendarIds(vacation.userId)) for (const id of await calendarManagerIds(calendarId)) all.add(id);
    ids = [...all];
  }
  ids = ids.filter((id) => id !== actorUserId);
  if (ids.length === 0) return [];
  return db
    .select({ id: user.id, email: user.email, name: user.name, banned: user.banned })
    .from(user)
    .where(inArray(user.id, ids))
    .all()
    .filter((u) => !u.banned && u.email && getPreferences(u.id)[pref])
    .map(({ id, email, name }) => ({ id, email, name }));
}
