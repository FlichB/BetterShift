import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/sessions";
import { isAuthEnabled } from "@/lib/auth/feature-flags";
import { logUserAction } from "@/lib/audit-log";
import { rateLimit } from "@/lib/rate-limiter";
import { canManageRotations } from "@/lib/rotation/permissions";
import { calendarNameOf } from "@/lib/rotation/references";
import { getRotation, runGeneration } from "@/lib/rotation/service";
import { validateRange } from "@/lib/rotation/validate";
import { readJson, rotationErrorResponse } from "@/lib/rotation/http";
import type { RotationGeneratedMetadata } from "@/lib/rotation/audit";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rotation = getRotation(id);
    if (!rotation) return NextResponse.json({ error: "notFound" }, { status: 404 });
    const user = await getSessionUser(request.headers);
    if (!(await canManageRotations(user?.id, rotation.calendarId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const rateLimitResponse = rateLimit(request, user?.id, "bundle-mutations", rotation.calendarId);
    if (rateLimitResponse) return rateLimitResponse;

    const range = validateRange(await readJson(request));
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });

    // Signups need a non-null signedUpBy. With auth off there is no session user,
    // so fall back to the rotation's creator, then the calendar owner.
    let actorId: string | null = user?.id ?? null;
    if (!actorId && !isAuthEnabled()) {
      actorId =
        rotation.createdBy ??
        db.select({ ownerId: calendars.ownerId }).from(calendars).where(eq(calendars.id, rotation.calendarId)).get()
          ?.ownerId ??
        null;
    }
    if (!actorId) return NextResponse.json({ error: "actor" }, { status: 400 });

    const summary = await runGeneration(id, range.value.from, range.value.to, actorId, new Date());
    await logUserAction<RotationGeneratedMetadata>({
      action: "rotation.generated",
      userId: user?.id ?? actorId,
      resourceType: "rotation",
      resourceId: id,
      metadata: {
        rotationName: rotation.name,
        calendarId: rotation.calendarId,
        calendarName: calendarNameOf(rotation.calendarId),
        from: range.value.from,
        to: range.value.to,
        created: summary.created,
        updated: summary.updated,
        deleted: summary.deleted,
      },
      request,
    });
    return NextResponse.json(summary);
  } catch (error) {
    return rotationErrorResponse(error, "Failed to generate rotation duties:");
  }
}
