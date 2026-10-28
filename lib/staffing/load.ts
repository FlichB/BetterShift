// [fork] Mindestbesetzung: builds the StaffingIndex for a set of people from the database (design §3).
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { dayOffs } from "@/lib/dayoff/schema";
import { loadClosedSet, type Reader } from "@/lib/dayoff/workdays";
import { rotationMembers, rotations } from "@/lib/rotation/schema";
import { StaffingIndex, emptyStaffing, type PlacedDayOff, type StaffingScope } from "@/lib/staffing/index";
import { approvedRanges } from "@/lib/vacation/dates";

/**
 * Scopes = rotations with a Mindestbesetzung in which one of `userIds` is Teilnehmer. Absences =
 * approved vacations and Dienstfreie dated in [from, to] of every Teilnehmer of those scopes
 * (standard, moved, agreed; only moved and agreed with `fixedOnly`), minus `excludeDayOffIds`.
 */
export function loadStaffing(
  reader: Reader,
  userIds: readonly string[],
  from: string,
  to: string,
  options: { excludeDayOffIds?: Iterable<string>; fixedOnly?: boolean } = {}
): StaffingIndex {
  if (userIds.length === 0 || from > to) return emptyStaffing();
  const ids = [
    ...new Set(
      reader
        .select({ id: rotations.id })
        .from(rotations)
        .innerJoin(rotationMembers, eq(rotationMembers.rotationId, rotations.id))
        .where(and(isNotNull(rotations.minPresent), inArray(rotationMembers.userId, [...userIds])))
        .all()
        .map((r) => r.id)
    ),
  ];
  if (ids.length === 0) return emptyStaffing();

  const members = reader
    .select({ rotationId: rotationMembers.rotationId, userId: rotationMembers.userId })
    .from(rotationMembers)
    .where(inArray(rotationMembers.rotationId, ids))
    .all();
  const scopes: StaffingScope[] = reader
    .select()
    .from(rotations)
    .where(inArray(rotations.id, ids))
    .all()
    .map((rotation) => ({
      rotationId: rotation.id,
      rotationName: rotation.name,
      minimum: rotation.minPresent!,
      participants: [...new Set(members.filter((m) => m.rotationId === rotation.id).map((m) => m.userId))],
      closed: loadClosedSet(reader, rotation, from, to),
    }))
    // A minimum that is not below the headcount (e.g. after a member was deleted) can never be met: ignore it.
    .filter((scope) => scope.minimum < scope.participants.length);

  const people = [...new Set(scopes.flatMap((s) => s.participants))];
  const statuses = options.fixedOnly ? (["moved", "agreed"] as const) : (["standard", "moved", "agreed"] as const);
  const exclude = new Set(options.excludeDayOffIds ?? []);
  const placed = reader
    .select({ id: dayOffs.id, userId: dayOffs.userId, date: dayOffs.date })
    .from(dayOffs)
    .where(and(inArray(dayOffs.userId, people), inArray(dayOffs.status, [...statuses]), gte(dayOffs.date, from), lte(dayOffs.date, to)))
    .all()
    .filter((d): d is PlacedDayOff => d.date !== null && !exclude.has(d.id));

  return new StaffingIndex(scopes, approvedRanges(reader, people), placed);
}
