// [fork] Jahresausgleich (SPEC 12.41): Delta tables of a rotation and a manager's overrides.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { logUserAction } from "@/lib/audit-log";
import { rateLimit } from "@/lib/rate-limiter";
import { canManageRotations } from "@/lib/rotation/permissions";
import { calendarNameOf } from "@/lib/rotation/references";
import { getRotation, getYearDeltaTables, setYearDeltaOverride } from "@/lib/rotation/service";
import { readJson, rotationErrorResponse } from "@/lib/rotation/http";
import { validateYearDeltaOverride } from "@/lib/rotation/validate";
import type { RotationYearDeltaSetMetadata } from "@/lib/rotation/audit";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rotation = getRotation(id);
    if (!rotation) return NextResponse.json({ error: "notFound" }, { status: 404 });
    const user = await getSessionUser(request.headers);
    if (!(await canManageRotations(user?.id, rotation.calendarId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(getYearDeltaTables(id, new Date()));
  } catch (error) {
    return rotationErrorResponse(error, "Failed to load year deltas:");
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const parsed = validateYearDeltaOverride(await readJson(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const now = new Date();
    setYearDeltaOverride(id, parsed.value, user?.id ?? null, now);
    await logUserAction<RotationYearDeltaSetMetadata>({
      action: "rotation.year_delta_set",
      userId: user?.id,
      resourceType: "rotation",
      resourceId: id,
      metadata: {
        rotationName: rotation.name,
        calendarId: rotation.calendarId,
        calendarName: calendarNameOf(rotation.calendarId),
        ...parsed.value,
      },
      request,
    });
    return NextResponse.json(getYearDeltaTables(id, now));
  } catch (error) {
    return rotationErrorResponse(error, "Failed to set year delta:");
  }
}
