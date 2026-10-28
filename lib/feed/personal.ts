// [fork] Personal ICS feed "nur meine Dienste" (spec 12.20): every duty the user currently holds a
// Platz in, across calendars, so swaps show up on the next client refresh without further action.
import { and, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars as calendarsTable, shiftSignups, shifts, user } from "@/lib/db/schema";
import { canReadFeed } from "@/lib/calendar-feed";
import { formatDateToLocal } from "@/lib/date-utils";
import { buildIcsCalendar, type IcsCalendar } from "@/lib/ics";
import { dayOffs } from "@/lib/dayoff/schema"; // [fork]
import { getMailTranslator } from "@/lib/notify/translator";
import { getAppUrl } from "@/lib/outlook/config";
import { entryTitle } from "@/lib/rotation/entry-title";
import { addDays } from "@/lib/rotation/dates";
import { rotationDuties, rotations } from "@/lib/rotation/schema";

export const PERSONAL_FEED_PAST_DAYS = 60;

export interface PersonalDuty {
  shiftId: string;
  calendarId: string;
  date: string;
  partners: string[];
  /** the rotation's Eintragsvorlage filled in for this user, as shown in the feed */
  title: string;
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
    .select({
      shiftId: rotationDuties.shiftId,
      calendarId: shifts.calendarId,
      date: rotationDuties.date,
      shiftTitle: shifts.title,
      entryTitle: rotations.entryTitle,
    })
    .from(shiftSignups)
    .innerJoin(rotationDuties, eq(rotationDuties.shiftId, shiftSignups.shiftId))
    .innerJoin(rotations, eq(rotations.id, rotationDuties.rotationId))
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

  const me = db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId)).get();
  const duties = mine.map(({ shiftTitle, entryTitle: template, ...r }) => ({
    ...r,
    title: entryTitle(template, me ?? { name: null, email: null }, shiftTitle),
    partners: partners
      .filter((p) => p.shiftId === r.shiftId && p.name)
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b)),
  }));
  return { calendars, duties };
}

export interface PersonalDayOff {
  id: string;
  date: string;
  title: string;
}

/** [fork] The user's dated Dienstfreie of the last 60 days onwards; undated (locked, dropped) ones are left out. */
export async function loadPersonalDayOffs(userId: string, now: Date): Promise<PersonalDayOff[]> {
  const from = addDays(formatDateToLocal(now), -PERSONAL_FEED_PAST_DAYS);
  const rows = db
    .select({
      id: dayOffs.id,
      date: dayOffs.date,
      status: dayOffs.status,
      calendarId: rotations.calendarId,
      template: rotations.dayOffTitle,
      dutyTitle: shifts.title,
    })
    .from(dayOffs)
    .innerJoin(rotations, eq(rotations.id, dayOffs.rotationId))
    .leftJoin(shifts, eq(shifts.id, dayOffs.shiftId))
    .where(and(eq(dayOffs.userId, userId), eq(rotations.dayOffEnabled, true), isNotNull(dayOffs.shiftId), gte(dayOffs.date, from)))
    .all()
    .filter((r) => r.date && ["standard", "moved", "agreed"].includes(r.status));
  if (rows.length === 0) return [];

  const allowed = new Set<string>();
  for (const calendarId of new Set(rows.map((r) => r.calendarId))) {
    if (await canReadFeed(userId, calendarId)) allowed.add(calendarId);
  }
  const me = db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId)).get() ?? { name: null, email: null };
  return rows
    .filter((r) => allowed.has(r.calendarId))
    .map((r) => ({ id: r.id, date: r.date!, title: entryTitle(r.template, me, r.dutyTitle ?? "") }));
}

export async function buildPersonalFeed(userId: string, now: Date): Promise<string> {
  const { t, locale } = await getMailTranslator();
  const { calendars, duties } = await loadPersonalDuties(userId, now);
  const swapLine = t("personalFeed.swapLink", { url: `${getAppUrl()}/swaps` });
  const dayOffLine = t("personalFeed.dayOffLink", { url: `${getAppUrl()}/swaps?tab=dayOffs` }); // [fork]
  const dayOffEvents = (await loadPersonalDayOffs(userId, now)).map((d) => ({
    uid: `dayoff-${d.id}-me`,
    date: d.date,
    summary: d.title,
    description: dayOffLine,
  }));
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
      titles: new Map(duties.map((d) => [d.shiftId, d.title])),
      extraEvents: dayOffEvents, // [fork]
    },
  });
}
