import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { canManageRotations } from "@/lib/rotation/permissions";
import { getRotation, previewGeneration } from "@/lib/rotation/service";
import { validateRange } from "@/lib/rotation/validate";
import { readJson, rotationErrorResponse } from "@/lib/rotation/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rotation = getRotation(id);
    if (!rotation) return NextResponse.json({ error: "notFound" }, { status: 404 });
    const user = await getSessionUser(request.headers);
    if (!(await canManageRotations(user?.id, rotation.calendarId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const range = validateRange(await readJson(request));
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });
    return NextResponse.json(await previewGeneration(id, range.value.from, range.value.to, new Date()));
  } catch (error) {
    return rotationErrorResponse(error, "Failed to preview rotation:");
  }
}
