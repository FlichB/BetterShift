import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { logUserAction } from "@/lib/audit-log";
import { rateLimit } from "@/lib/rate-limiter";
import { canManageRotations } from "@/lib/rotation/permissions";
import { calendarNameOf } from "@/lib/rotation/references";
import { getRotation, removeSlotLock } from "@/lib/rotation/service";
import { readJson, rotationErrorResponse } from "@/lib/rotation/http";
import type { RotationLockRemovedMetadata } from "@/lib/rotation/audit";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const body = (await readJson(request)) as { shiftId?: unknown; userId?: unknown } | null | undefined;
    if (!body || typeof body.shiftId !== "string" || typeof body.userId !== "string" || !body.shiftId || !body.userId) {
      return NextResponse.json({ error: "locks" }, { status: 400 });
    }
    if (!removeSlotLock(body.shiftId, body.userId, id)) {
      return NextResponse.json({ error: "notFound" }, { status: 404 });
    }
    await logUserAction<RotationLockRemovedMetadata>({
      action: "rotation.lock_removed",
      userId: user?.id,
      resourceType: "rotation",
      resourceId: id,
      metadata: {
        rotationName: rotation.name,
        calendarId: rotation.calendarId,
        calendarName: calendarNameOf(rotation.calendarId),
        shiftId: body.shiftId,
        userId: body.userId,
      },
      request,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return rotationErrorResponse(error, "Failed to remove slot lock:");
  }
}
