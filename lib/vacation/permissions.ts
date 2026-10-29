// [fork] Urlaub: who may request, and who is the Verwaltung of a person (SPEC 12.43 points 2, 3).
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { canManageRotations } from "@/lib/rotation/permissions";
import { rotationMembers, rotations } from "@/lib/rotation/schema";

export function isParticipant(userId: string): boolean {
  return Boolean(db.select({ userId: rotationMembers.userId }).from(rotationMembers).where(eq(rotationMembers.userId, userId)).get());
}

/** Calendars of the rotations in which the user is a Teilnehmer. */
export function managerCalendarIds(userId: string): string[] {
  const rows = db
    .select({ calendarId: rotations.calendarId })
    .from(rotationMembers)
    .innerJoin(rotations, eq(rotations.id, rotationMembers.rotationId))
    .where(eq(rotationMembers.userId, userId))
    .all();
  return [...new Set(rows.map((r) => r.calendarId))];
}

export async function isManagerOf(actorId: string, userId: string): Promise<boolean> {
  for (const calendarId of managerCalendarIds(userId)) if (await canManageRotations(actorId, calendarId)) return true;
  return false;
}

/** Everyone who is a Teilnehmer of a rotation in a calendar the actor manages. */
export async function managedUserIds(actorId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const all = db.select({ id: calendars.id }).from(calendars).all();
  const managed: string[] = [];
  for (const c of all) if (await canManageRotations(actorId, c.id)) managed.push(c.id);
  if (managed.length === 0) return ids;
  const rows = db
    .select({ userId: rotationMembers.userId })
    .from(rotationMembers)
    .innerJoin(rotations, eq(rotations.id, rotationMembers.rotationId))
    .where(inArray(rotations.calendarId, managed))
    .all();
  for (const r of rows) ids.add(r.userId);
  return ids;
}
