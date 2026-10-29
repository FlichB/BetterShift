import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { externalSyncs, shifts, calendars } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/sessions";
import { hasCapability } from "@/lib/auth/permissions";
import {
  isValidCalendarUrl,
  type CalendarSyncType,
} from "@/lib/external-calendar-utils";
import { logUserAction, type SyncDeletedMetadata } from "@/lib/audit-log";
import { setYearsAhead, withYearsAhead } from "@/lib/sync-window/store"; // [fork]
import { isValidYearsAhead, MAX_YEARS_AHEAD } from "@/lib/sync-window/window"; // [fork]

// GET single external sync
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [externalSync] = await db
      .select()
      .from(externalSyncs)
      .where(eq(externalSyncs.id, id))
      .limit(1);

    if (!externalSync) {
      return NextResponse.json(
        { error: "External sync not found" },
        { status: 404 }
      );
    }

    // Fetch calendar to verify it exists
    const [calendar] = await db
      .select()
      .from(calendars)
      .where(eq(calendars.id, externalSync.calendarId));

    if (!calendar) {
      return NextResponse.json(
        { error: "Calendar not found" },
        { status: 404 }
      );
    }

    // Check view permissions (works for both authenticated users and guests)
    const user = await getSessionUser(request.headers);
    const hasAccess = await hasCapability(
      user?.id,
      externalSync.calendarId,
      "viewShifts"
    );
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Insufficient permissions. Read access required." },
        { status: 403 }
      );
    }

    return NextResponse.json(withYearsAhead([externalSync])[0]); // [fork]
  } catch (error) {
    console.error("Failed to fetch external sync:", error);
    return NextResponse.json(
      { error: "Failed to fetch external sync" },
      { status: 500 }
    );
  }
}

// PATCH update external sync
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      calendarUrl,
      color,
      displayMode,
      isHidden,
      hideFromStats,
      autoSyncInterval,
      yearsAhead, // [fork]
    } = body;

    // Get existing sync to validate URL with correct sync type
    const [existingSync] = await db
      .select()
      .from(externalSyncs)
      .where(eq(externalSyncs.id, id))
      .limit(1);

    if (!existingSync) {
      return NextResponse.json(
        { error: "External sync not found" },
        { status: 404 }
      );
    }

    // Fetch calendar to verify it exists
    const [calendar] = await db
      .select()
      .from(calendars)
      .where(eq(calendars.id, existingSync.calendarId));

    if (!calendar) {
      return NextResponse.json(
        { error: "Calendar not found" },
        { status: 404 }
      );
    }

    // Check edit permissions (works for both authenticated users and guests)
    const user = await getSessionUser(request.headers);
    const hasAccess = await hasCapability(
      user?.id,
      existingSync.calendarId,
      "manageExternalSync"
    );
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Insufficient permissions. Write access required." },
        { status: 403 }
      );
    }

    // Validate calendar URL if provided
    if (calendarUrl !== undefined) {
      if (
        !isValidCalendarUrl(
          calendarUrl,
          existingSync.syncType as CalendarSyncType
        )
      ) {
        const domain =
          existingSync.syncType === "icloud" ? "icloud.com" : "google.com";
        return NextResponse.json(
          {
            error: `Invalid ${existingSync.syncType} calendar URL. URL must use webcal:// or https:// protocol and be from ${domain} domain`,
          },
          { status: 400 }
        );
      }
    }

    // Validate autoSyncInterval if provided
    const validIntervals = [0, 5, 15, 30, 60, 120, 360, 720, 1440];
    if (
      autoSyncInterval !== undefined &&
      !validIntervals.includes(autoSyncInterval)
    ) {
      return NextResponse.json(
        {
          error: `Invalid auto-sync interval. Must be one of: ${validIntervals.join(
            ", "
          )} minutes`,
        },
        { status: 400 }
      );
    }

    // [fork] Import horizon in years after the current one
    if (yearsAhead !== undefined && !isValidYearsAhead(yearsAhead)) {
      return NextResponse.json(
        { error: `Invalid import horizon. Must be a whole number of years from 0 to ${MAX_YEARS_AHEAD}` },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateData.name = name;
    if (calendarUrl !== undefined) updateData.calendarUrl = calendarUrl;
    if (color !== undefined) updateData.color = color;
    if (displayMode !== undefined) updateData.displayMode = displayMode;
    if (isHidden !== undefined) updateData.isHidden = isHidden;
    if (hideFromStats !== undefined) updateData.hideFromStats = hideFromStats;
    if (autoSyncInterval !== undefined)
      updateData.autoSyncInterval = autoSyncInterval;

    const [updated] = await db
      .update(externalSyncs)
      .set(updateData)
      .where(eq(externalSyncs.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "External sync not found" },
        { status: 404 }
      );
    }

    // If color was updated, also update the color of all associated shifts
    if (color !== undefined) {
      await db
        .update(shifts)
        .set({
          color: color,
          updatedAt: new Date(),
        })
        .where(eq(shifts.externalSyncId, id));
    }

    // [fork] An uploaded file is never synced again, so it keeps no horizon
    if (yearsAhead !== undefined && !existingSync.isOneTimeImport) setYearsAhead(id, yearsAhead);

    return NextResponse.json(withYearsAhead([updated])[0]); // [fork]
  } catch (error) {
    console.error("Failed to update external sync:", error);
    return NextResponse.json(
      { error: "Failed to update external sync" },
      { status: 500 }
    );
  }
}

// DELETE external sync and all associated shifts
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Fetch external sync to get calendar ID
    const [existingSync] = await db
      .select()
      .from(externalSyncs)
      .where(eq(externalSyncs.id, id));

    if (!existingSync) {
      return NextResponse.json(
        { error: "External sync not found" },
        { status: 404 }
      );
    }

    // Fetch calendar to verify it exists
    const [calendar] = await db
      .select()
      .from(calendars)
      .where(eq(calendars.id, existingSync.calendarId));

    if (!calendar) {
      return NextResponse.json(
        { error: "Calendar not found" },
        { status: 404 }
      );
    }

    // Check edit permissions (works for both authenticated users and guests)
    const user = await getSessionUser(request.headers);
    const hasAccess = await hasCapability(
      user?.id,
      existingSync.calendarId,
      "manageExternalSync"
    );
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Insufficient permissions. Write access required." },
        { status: 403 }
      );
    }

    await db.delete(externalSyncs).where(eq(externalSyncs.id, id));

    // Log external sync deletion event
    if (user) {
      await logUserAction<SyncDeletedMetadata>({
        action: "sync.deleted",
        userId: user.id,
        resourceType: "sync",
        resourceId: id,
        metadata: {
          calendarName: calendar.name,
          syncUrl: existingSync.isOneTimeImport
            ? "file-upload"
            : existingSync.calendarUrl,
          syncName: existingSync.name,
        },
        request,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete external sync:", error);
    return NextResponse.json(
      { error: "Failed to delete external sync" },
      { status: 500 }
    );
  }
}
