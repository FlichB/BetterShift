// [fork] Personal ICS feed "nur meine Dienste" (spec 12.20): every duty the user currently holds a
// Platz in, across calendars, so swaps show up on the next client refresh without further action.
import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars as calendarsTable, shiftSignups, shifts, user } from "@/lib/db/schema";
import { canReadFeed } from "@/lib/calendar-feed";
import { formatDateToLocal } from "@/lib/date-utils";
import { buildIcsCalendar, type IcsCalendar } from "@/lib/ics";
import { getMailTranslator } from "@/lib/notify/translator";
import { getAppUrl } from "@/lib/outlook/config";
import { addDays } from "@/lib/rotation/dates";
import { rotationDuties } from "@/lib/rotation/schema";

export const PERSONAL_FEED_PAST_DAYS = 60;

export interface PersonalDuty {
  shiftId: string;
  calendarId: string;
  date: string;
  partners: string[];
}

/** Same rule as canReadFeed() and better-auth's admin plugin: an expired ban no longer counts. */
export function isUserBanned(userId: string, now: Date): boolean {
  const row = db.select({ banned: user.banned, banExpires: user.banExpires }).from(user).where(eq(user.id, userId)).get();
  if (!row?.banned) return false;
  return !row.banExpires || row.banExpires.getTime() > now.getTime();
}

export async function loadPersonalDuties(
  userId: string,
  now: Date
): Promise<{ calendars: IcsCalendar[]; duties: PersonalDuty[] }> {
  const from = addDays(formatDateToLocal(now), -PERSONAL_FEED_PAST_DAYS);
  const rows = db
    .select({ shiftId: rotationDuties.shiftId, calendarId: shifts.calendarId, date: rotationDuties.date })
    .from(shiftSignups)
    .innerJoin(rotationDuties, eq(rotationDuties.shiftId, shiftSignups.shiftId))
    .innerJoin(shifts, eq(shifts.id, shiftSignups.shiftId))
    .where(and(eq(shiftSignups.userId, userId), gte(rotationDuties.date, from)))
    .all();

  // Feeds carry no session: re-check read access per calendar, ignoring share-link cookies.
  const allowed = new Set<string>();
  for (const calendarId of new Set(rows.map((r) => r.calendarId))) {
    if (await canReadFeed(userId, calendarId)) allowed.add(calendarId);
  }
  const mine = rows.filter((r) => allowed.has(r.calendarId));
  if (mine.length === 0) return { calendars: [], duties: [] };

  const calendars = db
    .select({ id: calendarsTable.id, name: calendarsTable.name, splitShiftsEnabled: calendarsTable.splitShiftsEnabled })
    .from(calendarsTable)
    .where(inArray(calendarsTable.id, [...allowed]))
    .all();
  const partners = db
    .select({ shiftId: shiftSignups.shiftId, name: user.name })
    .from(shiftSignups)
    .innerJoin(user, eq(user.id, shiftSignups.userId))
    .where(and(inArray(shiftSignups.shiftId, mine.map((r) => r.shiftId)), ne(shiftSignups.userId, userId)))
    .all();

  const duties = mine.map((r) => ({
    ...r,
    partners: partners
      .filter((p) => p.shiftId === r.shiftId && p.name)
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b)),
  }));
  return { calendars, duties };
}

export async function buildPersonalFeed(userId: string, now: Date): Promise<string> {
  const { t, locale } = await getMailTranslator();
  const { calendars, duties } = await loadPersonalDuties(userId, now);
  const swapLine = t("personalFeed.swapLink", { url: `${getAppUrl()}/swaps` });
  const extraLines = new Map(
    duties.map((d) => [
      d.shiftId,
      d.partners.length > 0 ? [t("personalFeed.with", { names: d.partners.join(", ") }), swapLine] : [swapLine],
    ])
  );
  return buildIcsCalendar({
    calendars,
    locale,
    feed: true,
    only: {
      shiftIds: duties.map((d) => d.shiftId),
      extraLines,
      uidSuffix: "-me",
      calendarName: t("personalFeed.calendarName"),
    },
  });
}
