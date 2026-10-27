import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { logUserAction } from "@/lib/audit-log";
import { rateLimit } from "@/lib/rate-limiter";
import { canManageRotations } from "@/lib/rotation/permissions";
import { calendarNameOf, checkRotationReferences } from "@/lib/rotation/references";
import { createRotation, listRotations } from "@/lib/rotation/service";
import { validateRotationInput } from "@/lib/rotation/validate";
import { readJson, rotationErrorResponse } from "@/lib/rotation/http";
import type { RotationCreatedMetadata } from "@/lib/rotation/audit";

export async function GET(request: NextRequest) {
  try {
    const calendarId = request.nextUrl.searchParams.get("calendarId");
    if (!calendarId) return NextResponse.json({ error: "calendarId" }, { status: 400 });
    const user = await getSessionUser(request.headers);
    if (!(await canManageRotations(user?.id, calendarId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(listRotations(calendarId));
  } catch (error) {
    return rotationErrorResponse(error, "Failed to list rotations:");
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser(request.headers);
    const parsed = validateRotationInput(await readJson(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    if (!(await canManageRotations(user?.id, input.calendarId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const rateLimitResponse = rateLimit(request, user?.id, "bundle-mutations", input.calendarId);
    if (rateLimitResponse) return rateLimitResponse;

    const referenceError = await checkRotationReferences(input, user?.id);
    if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });

    const rotation = createRotation(input, user?.id ?? null);
    await logUserAction<RotationCreatedMetadata>({
      action: "rotation.created",
      userId: user?.id,
      resourceType: "rotation",
      resourceId: rotation.id,
      metadata: {
        rotationName: rotation.name,
        calendarId: input.calendarId,
        calendarName: calendarNameOf(input.calendarId),
        memberCount: input.memberIds.length,
        perShift: input.perShift,
      },
      request,
    });
    return NextResponse.json(rotation, { status: 201 });
  } catch (error) {
    return rotationErrorResponse(error, "Failed to create rotation:");
  }
}
