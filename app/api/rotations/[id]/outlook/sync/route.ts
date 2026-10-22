import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { rateLimit } from "@/lib/rate-limiter";
import { isOutlookConfigured } from "@/lib/outlook/config";
import { resetBackoff } from "@/lib/outlook/sync";
import { outlookWorker } from "@/lib/outlook/worker";
import { rotationErrorResponse } from "@/lib/rotation/http";
import { canManageRotations } from "@/lib/rotation/permissions";
import { getRotation } from "@/lib/rotation/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rotation = getRotation(id);
    if (!rotation) return NextResponse.json({ error: "notFound" }, { status: 404 });
    const user = await getSessionUser(request.headers);
    if (!(await canManageRotations(user?.id, rotation.calendarId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const rateLimitResponse = rateLimit(request, user?.id, "outlook-sync");
    if (rateLimitResponse) return rateLimitResponse;
    if (!isOutlookConfigured()) return NextResponse.json({ error: "outlookNotConfigured" }, { status: 400 });

    resetBackoff(id);
    outlookWorker.kick();
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    return rotationErrorResponse(error, "Failed to start Outlook sync:");
  }
}
