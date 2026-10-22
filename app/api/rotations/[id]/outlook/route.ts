import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { logUserAction } from "@/lib/audit-log";
import { rateLimit } from "@/lib/rate-limiter";
import type { OutlookToggleMetadata } from "@/lib/outlook/audit";
import { isOutlookConfigured } from "@/lib/outlook/config";
import { outlookStatus, setOutlookEnabled } from "@/lib/outlook/rotation";
import { outlookWorker } from "@/lib/outlook/worker";
import { readJson, rotationErrorResponse } from "@/lib/rotation/http";
import { canManageRotations } from "@/lib/rotation/permissions";
import { calendarNameOf } from "@/lib/rotation/references";
import { getRotation } from "@/lib/rotation/service";

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
    return NextResponse.json(outlookStatus(id, rotation.outlookEnabled, new Date()));
  } catch (error) {
    return rotationErrorResponse(error, "Failed to load Outlook status:");
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
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

    const body = await readJson(request);
    const enabled = typeof body === "object" && body !== null ? (body as { enabled?: unknown }).enabled : undefined;
    if (typeof enabled !== "boolean") return NextResponse.json({ error: "invalid" }, { status: 400 });
    if (enabled && !isOutlookConfigured()) return NextResponse.json({ error: "outlookNotConfigured" }, { status: 400 });

    setOutlookEnabled(id, enabled);
    await logUserAction<OutlookToggleMetadata>({
      action: enabled ? "outlook.enabled" : "outlook.disabled",
      userId: user?.id,
      resourceType: "rotation",
      resourceId: id,
      metadata: { rotationName: rotation.name, calendarId: rotation.calendarId, calendarName: calendarNameOf(rotation.calendarId) },
      request,
    });
    outlookWorker.kick();
    return NextResponse.json(outlookStatus(id, enabled, new Date()));
  } catch (error) {
    return rotationErrorResponse(error, "Failed to switch Outlook sync:");
  }
}
