import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { logUserAction } from "@/lib/audit-log";
import { rateLimit } from "@/lib/rate-limiter";
import { canManageRotations } from "@/lib/rotation/permissions";
import { calendarNameOf, checkRotationReferences } from "@/lib/rotation/references";
import { deleteRotation, getRotation, updateRotation } from "@/lib/rotation/service";
import { validateRotationInput } from "@/lib/rotation/validate";
import { readJson, rotationErrorResponse } from "@/lib/rotation/http";
import type { RotationDeletedMetadata, RotationUpdatedMetadata } from "@/lib/rotation/audit";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const rotation = getRotation(id);
    if (!rotation) return NextResponse.json({ error: "notFound" }, { status: 404 });
    const user = await getSessionUser(request.headers);
    if (!(await canManageRotations(user?.id, rotation.calendarId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(rotation);
  } catch (error) {
    return rotationErrorResponse(error, "Failed to load rotation:");
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const existing = getRotation(id);
    if (!existing) return NextResponse.json({ error: "notFound" }, { status: 404 });
    const user = await getSessionUser(request.headers);
    if (!(await canManageRotations(user?.id, existing.calendarId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const rateLimitResponse = rateLimit(request, user?.id, "bundle-mutations", existing.calendarId);
    if (rateLimitResponse) return rateLimitResponse;

    const parsed = validateRotationInput(await readJson(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;
    if (input.calendarId !== existing.calendarId) {
      return NextResponse.json({ error: "calendarId" }, { status: 400 });
    }
    const referenceError = await checkRotationReferences(input);
    if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });

    const rotation = updateRotation(id, input);
    await logUserAction<RotationUpdatedMetadata>({
      action: "rotation.updated",
      userId: user?.id,
      resourceType: "rotation",
      resourceId: id,
      metadata: {
        rotationName: rotation.name,
        calendarId: rotation.calendarId,
        calendarName: calendarNameOf(rotation.calendarId),
        memberCount: input.memberIds.length,
        startDate: input.startDate,
      },
      request,
    });
    return NextResponse.json(rotation);
  } catch (error) {
    return rotationErrorResponse(error, "Failed to update rotation:");
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const existing = getRotation(id);
    if (!existing) return NextResponse.json({ error: "notFound" }, { status: 404 });
    const user = await getSessionUser(request.headers);
    if (!(await canManageRotations(user?.id, existing.calendarId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const rateLimitResponse = rateLimit(request, user?.id, "bundle-mutations", existing.calendarId);
    if (rateLimitResponse) return rateLimitResponse;

    const deleteFutureDuties = request.nextUrl.searchParams.get("deleteFutureDuties") === "1";
    const { deletedDuties } = deleteRotation(id, { deleteFutureDuties }, new Date());
    await logUserAction<RotationDeletedMetadata>({
      action: "rotation.deleted",
      userId: user?.id,
      resourceType: "rotation",
      resourceId: id,
      metadata: {
        rotationName: existing.name,
        calendarId: existing.calendarId,
        calendarName: calendarNameOf(existing.calendarId),
        deletedDuties,
      },
      request,
    });
    return NextResponse.json({ deletedDuties });
  } catch (error) {
    return rotationErrorResponse(error, "Failed to delete rotation:");
  }
}
