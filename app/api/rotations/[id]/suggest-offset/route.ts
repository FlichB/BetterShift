import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { isValidLocalDate } from "@/lib/rotation/dates";
import { canManageRotations } from "@/lib/rotation/permissions";
import { getRotation, suggestOffsetFor } from "@/lib/rotation/service";
import { rotationErrorResponse } from "@/lib/rotation/http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rotation = getRotation(id);
    if (!rotation) return NextResponse.json({ error: "notFound" }, { status: 404 });
    const user = await getSessionUser(request.headers);
    if (!(await canManageRotations(user?.id, rotation.calendarId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const date = request.nextUrl.searchParams.get("date") ?? "";
    if (!isValidLocalDate(date)) return NextResponse.json({ error: "startDate" }, { status: 400 });
    const memberIds = (request.nextUrl.searchParams.get("memberIds") ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    return NextResponse.json({ startOffset: suggestOffsetFor(id, date, memberIds) });
  } catch (error) {
    return rotationErrorResponse(error, "Failed to suggest offset:");
  }
}
