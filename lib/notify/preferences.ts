// [fork] Per-user switches for swap notification mails (spec 12.27). A missing row means everything on.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationPreferences, type NotificationKind } from "@/lib/notify/schema";
import type { NotificationPreferences } from "@/lib/notify/types";

export const DEFAULT_PREFERENCES: NotificationPreferences = { offersToAll: true, offersToMe: true, myOffers: true };

export function preferenceFor(kind: NotificationKind): keyof NotificationPreferences {
  switch (kind) {
    case "offer_to_all":
    case "forced_to_all":
      return "offersToAll";
    case "offer_to_me":
    case "forced_to_me":
      return "offersToMe";
    case "offer_accepted":
    case "offer_declined":
    case "duty_transferred":
    case "counter_chosen":
      return "myOffers";
  }
}

export function getPreferences(userId: string): NotificationPreferences {
  const row = db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).get();
  return row ? { offersToAll: row.offersToAll, offersToMe: row.offersToMe, myOffers: row.myOffers } : { ...DEFAULT_PREFERENCES };
}

export function setPreferences(userId: string, prefs: NotificationPreferences): NotificationPreferences {
  db.insert(notificationPreferences)
    .values({ userId, ...prefs })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: prefs })
    .run();
  return prefs;
}

/** Exactly the three boolean switches; anything else is rejected. */
export function validatePreferences(body: unknown): NotificationPreferences | null {
  if (typeof body !== "object" || body === null) return null;
  const { offersToAll, offersToMe, myOffers } = body as Record<string, unknown>;
  if (typeof offersToAll !== "boolean" || typeof offersToMe !== "boolean" || typeof myOffers !== "boolean") return null;
  return { offersToAll, offersToMe, myOffers };
}
