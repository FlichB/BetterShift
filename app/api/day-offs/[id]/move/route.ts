// [fork] Dienstfrei API route.
import { NextRequest, NextResponse } from "next/server";
import { logUserAction } from "@/lib/audit-log";
import { dayOffAuditBase, type DayOffMovedMetadata } from "@/lib/dayoff/audit";
import { dayOffContext, dayOffError, dayOffErrorResponse } from "@/lib/dayoff/http";
import { canMoveOwnDayOff } from "@/lib/dayoff/permissions";
import { moveDayOff } from "@/lib/dayoff/service";
import { validateDate } from "@/lib/dayoff/validate";
import { outlookWorker } from "@/lib/outlook/worker";
import { readJson } from "@/lib/rotation/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await dayOffContext(request, id);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isHolder) return dayOffError("notHolder");
    if (!(await canMoveOwnDayOff(ctx.userId, ctx.calendarId))) return dayOffError("forbidden");
    const parsed = validateDate(await readJson(request));
    if (!parsed.ok) return dayOffError("invalid");

    const updated = moveDayOff(id, parsed.value.date, ctx.userId, new Date());
    await logUserAction<DayOffMovedMetadata>({
      action: "dayoff.moved",
      userId: ctx.userId,
      resourceType: "day_off",
      resourceId: id,
      metadata: { ...dayOffAuditBase(updated), from: ctx.row.date, to: parsed.value.date },
      request,
    });
    outlookWorker.kick();
    return NextResponse.json(updated);
  } catch (error) {
    return dayOffErrorResponse(error, "Failed to move Dienstfrei:");
  }
}
