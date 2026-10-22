import { NextRequest, NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars, shiftPresets } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/sessions";
import { getCalendarMembers, getUserAccessibleCalendars } from "@/lib/auth/permissions";
import { canManageRotations } from "@/lib/rotation/permissions";
import { rotationErrorResponse } from "@/lib/rotation/http";

// Calendars the caller may manage rotations in, with what the rotation form needs.
export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser(request.headers);
    const accessible = await getUserAccessibleCalendars(user?.id);
    const manageable: string[] = [];
    for (const { id } of accessible) {
      if (await canManageRotations(user?.id, id)) manageable.push(id);
    }
    if (manageable.length === 0) return NextResponse.json([]);

    const rows = db.select().from(calendars).where(inArray(calendars.id, manageable)).orderBy(asc(calendars.name)).all();
    const result = [];
    for (const calendar of rows) {
      const presets = db
        .select({
          id: shiftPresets.id,
          title: shiftPresets.title,
          startTime: shiftPresets.startTime,
          endTime: shiftPresets.endTime,
          archivedAt: shiftPresets.archivedAt,
        })
        .from(shiftPresets)
        .where(eq(shiftPresets.calendarId, calendar.id))
        .orderBy(asc(shiftPresets.order))
        .all();
      result.push({
        id: calendar.id,
        name: calendar.name,
        color: calendar.color,
        signupsEnabled: calendar.signupsEnabled,
        presets: presets.filter((p) => !p.archivedAt),
        members: (await getCalendarMembers(calendar.id)) ?? [],
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return rotationErrorResponse(error, "Failed to list rotation calendars:");
  }
}
