// [fork] Secret link of a user's personal ICS feed (spec 12.20). Rotating replaces the old link at once.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { generateAccessToken } from "@/lib/auth/token-auth";
import { personalFeedTokens, type PersonalFeedToken } from "@/lib/feed/schema";

export function getPersonalFeedToken(userId: string): PersonalFeedToken | null {
  return db.select().from(personalFeedTokens).where(eq(personalFeedTokens.userId, userId)).get() ?? null;
}

export function findPersonalFeedToken(token: string): PersonalFeedToken | null {
  return db.select().from(personalFeedTokens).where(eq(personalFeedTokens.token, token)).get() ?? null;
}

/** Creates the user's link, replacing an existing one in the same transaction. */
export function rotatePersonalFeedToken(userId: string, now: Date): { row: PersonalFeedToken; rotated: boolean } {
  return db.transaction((tx) => {
    const removed = tx.delete(personalFeedTokens).where(eq(personalFeedTokens.userId, userId)).returning().all();
    const row = tx
      .insert(personalFeedTokens)
      .values({ userId, token: generateAccessToken(), createdAt: now })
      .returning()
      .get();
    return { row, rotated: removed.length > 0 };
  });
}

/** true when a link existed. */
export function revokePersonalFeedToken(userId: string): boolean {
  return db.delete(personalFeedTokens).where(eq(personalFeedTokens.userId, userId)).returning().all().length > 0;
}

export function touchPersonalFeedToken(userId: string, now: Date): void {
  db.update(personalFeedTokens).set({ lastUsedAt: now }).where(eq(personalFeedTokens.userId, userId)).run();
}

// Outlook and some other clients only subscribe to URLs ending in .ics
export const personalFeedUrl = (appUrl: string, token: string): string => `${appUrl}/api/feed/me/${token}.ics`;
