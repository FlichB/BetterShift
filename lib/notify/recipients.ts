// [fork] Who receives a swap notification, decided at send time (spec 12.27): permissions are
// async and therefore cannot be checked inside the synchronous swap transaction.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendarShares, calendars, user, userCalendarSubscriptions } from "@/lib/db/schema";
import { getPreferences, preferenceFor } from "@/lib/notify/preferences";
import type { NotificationKind } from "@/lib/notify/schema";
import { canOtherUserSwap } from "@/lib/swap/permissions";
import type { ShiftSwap } from "@/lib/swap/schema";

export interface Recipient {
  id: string;
  email: string;
  name: string | null;
}

/** Owner, shared and subscribed users of a calendar who may swap there (spec B1). */
export async function swapCandidates(calendarId: string): Promise<string[]> {
  const owner = db.select({ id: calendars.ownerId }).from(calendars).where(eq(calendars.id, calendarId)).get();
  const shared = db.select({ id: calendarShares.userId }).from(calendarShares).where(eq(calendarShares.calendarId, calendarId)).all();
  const subscribed = db
    .select({ id: userCalendarSubscriptions.userId })
    .from(userCalendarSubscriptions)
    .where(and(eq(userCalendarSubscriptions.calendarId, calendarId), eq(userCalendarSubscriptions.status, "subscribed")))
    .all();
  const ids = new Set([owner?.id, ...shared.map((r) => r.id), ...subscribed.map((r) => r.id)].filter((id): id is string => Boolean(id)));

  const allowed: string[] = [];
  for (const id of ids) if (await canOtherUserSwap(id, calendarId)) allowed.push(id);
  return allowed;
}

export async function resolveRecipients(
  kind: NotificationKind,
  swap: ShiftSwap,
  calendarId: string,
  actorUserId: string | null
): Promise<Recipient[]> {
  let ids: string[];
  switch (kind) {
    case "offer_to_all":
      ids = await swapCandidates(calendarId);
      break;
    case "offer_to_me":
      ids = swap.targetUserId ? [swap.targetUserId] : [];
      break;
    case "offer_accepted":
    case "offer_declined":
      ids = [swap.offeredByUserId];
      break;
  }
  ids = ids.filter((id) => id !== actorUserId);
  if (ids.length === 0) return [];

  const pref = preferenceFor(kind);
  return db
    .select({ id: user.id, email: user.email, name: user.name, banned: user.banned })
    .from(user)
    .where(inArray(user.id, ids))
    .all()
    .filter((u) => !u.banned && u.email && getPreferences(u.id)[pref])
    .map(({ id, email, name }) => ({ id, email, name }));
}
