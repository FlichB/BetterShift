// [fork] Dienstfrei API route.
import { NextRequest, NextResponse } from "next/server";
import { logUserAction } from "@/lib/audit-log";
import { dayOffAuditBase, type DayOffLockedMetadata } from "@/lib/dayoff/audit";
import { dayOffContext, dayOffError, dayOffErrorResponse } from "@/lib/dayoff/http";
import { lockDayOff } from "@/lib/dayoff/service";
import { validateLock } from "@/lib/dayoff/validate";
import { outlookWorker } from "@/lib/outlook/worker";
import { readJson } from "@/lib/rotation/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await dayOffContext(request, id);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isManager) return dayOffError("forbidden");
    const parsed = validateLock(await readJson(request));
    if (!parsed.ok) return dayOffError("invalid");

    const updated = lockDayOff(id, parsed.value.note, ctx.userId, new Date());
    await logUserAction<DayOffLockedMetadata>({
      action: "dayoff.locked",
      userId: ctx.userId,
      resourceType: "day_off",
      resourceId: id,
      metadata: { ...dayOffAuditBase(updated), note: parsed.value.note },
      request,
    });
    outlookWorker.kick();
    return NextResponse.json(updated);
  } catch (error) {
    return dayOffErrorResponse(error, "Failed to lock Dienstfrei:");
  }
}
