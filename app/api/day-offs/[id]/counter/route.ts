// [fork] Dienstfrei API route.
import { NextRequest, NextResponse } from "next/server";
import { logUserAction } from "@/lib/audit-log";
import { dayOffAuditBase, type DayOffCounteredMetadata } from "@/lib/dayoff/audit";
import { dayOffContext, dayOffError, dayOffErrorResponse } from "@/lib/dayoff/http";
import { counterPropose } from "@/lib/dayoff/service";
import { validateDate } from "@/lib/dayoff/validate";
import { outlookWorker } from "@/lib/outlook/worker";
import { readJson } from "@/lib/rotation/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await dayOffContext(request, id);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isManager) return dayOffError("forbidden");
    const parsed = validateDate(await readJson(request));
    if (!parsed.ok) return dayOffError("invalid");

    const proposal = counterPropose(id, parsed.value.date, ctx.userId, new Date());
    await logUserAction<DayOffCounteredMetadata>({
      action: "dayoff.countered",
      userId: ctx.userId,
      resourceType: "day_off",
      resourceId: id,
      metadata: { ...dayOffAuditBase(ctx.row), date: parsed.value.date },
      request,
    });
    outlookWorker.kick();
    return NextResponse.json(proposal);
  } catch (error) {
    return dayOffErrorResponse(error, "Failed to counter-propose Dienstfrei date:");
  }
}
