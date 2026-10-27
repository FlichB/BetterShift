// [fork] Dienstfrei API route.
import { NextRequest, NextResponse } from "next/server";
import { logUserAction } from "@/lib/audit-log";
import { dayOffAuditBase, type DayOffProposedMetadata } from "@/lib/dayoff/audit";
import { dayOffContext, dayOffError, dayOffErrorResponse } from "@/lib/dayoff/http";
import { proposeDates } from "@/lib/dayoff/service";
import { validateDates } from "@/lib/dayoff/validate";
import { outlookWorker } from "@/lib/outlook/worker";
import { readJson } from "@/lib/rotation/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await dayOffContext(request, id);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isHolder) return dayOffError("notHolder");
    const parsed = validateDates(await readJson(request));
    if (!parsed.ok) return dayOffError("invalid");

    const proposals = proposeDates(id, parsed.value.dates, ctx.userId, new Date());
    await logUserAction<DayOffProposedMetadata>({
      action: "dayoff.proposed",
      userId: ctx.userId,
      resourceType: "day_off",
      resourceId: id,
      metadata: { ...dayOffAuditBase(ctx.row), dates: parsed.value.dates },
      request,
    });
    outlookWorker.kick();
    return NextResponse.json(proposals);
  } catch (error) {
    return dayOffErrorResponse(error, "Failed to propose Dienstfrei dates:");
  }
}
