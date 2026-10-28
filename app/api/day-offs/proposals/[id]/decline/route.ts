// [fork] Dienstfrei API route.
import { NextRequest, NextResponse } from "next/server";
import { logUserAction } from "@/lib/audit-log";
import { dayOffAuditBase, type DayOffDeclinedMetadata } from "@/lib/dayoff/audit";
import { dayOffError, dayOffErrorResponse, proposalContext } from "@/lib/dayoff/http";
import { declineProposal } from "@/lib/dayoff/service";
import { validateDecline } from "@/lib/dayoff/validate";
import { outlookWorker } from "@/lib/outlook/worker";
import { readJson } from "@/lib/rotation/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await proposalContext(request, id);
    if (ctx instanceof NextResponse) return ctx;
    const parsed = validateDecline(await readJson(request));
    if (!parsed.ok) return dayOffError("invalid");

    const proposal = declineProposal(id, parsed.value.reason, ctx.userId, ctx.isManager, new Date());
    await logUserAction<DayOffDeclinedMetadata>({
      action: "dayoff.declined",
      userId: ctx.userId,
      resourceType: "day_off",
      resourceId: ctx.row.id,
      metadata: { ...dayOffAuditBase(ctx.row), date: proposal.date, side: proposal.side, reason: proposal.declineReason },
      request,
    });
    outlookWorker.kick();
    return NextResponse.json(proposal);
  } catch (error) {
    return dayOffErrorResponse(error, "Failed to decline Dienstfrei proposal:");
  }
}
