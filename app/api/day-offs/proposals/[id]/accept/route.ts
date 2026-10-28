// [fork] Dienstfrei API route.
import { NextRequest, NextResponse } from "next/server";
import { logUserAction } from "@/lib/audit-log";
import { dayOffAuditBase, type DayOffAcceptedMetadata } from "@/lib/dayoff/audit";
import { dayOffErrorResponse, proposalContext } from "@/lib/dayoff/http";
import { acceptProposal } from "@/lib/dayoff/service";
import { outlookWorker } from "@/lib/outlook/worker";

// The context ensured holder or manager; the service enforces that the other side answers.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await proposalContext(request, id);
    if (ctx instanceof NextResponse) return ctx;

    const updated = acceptProposal(id, ctx.userId, ctx.isManager, new Date());
    await logUserAction<DayOffAcceptedMetadata>({
      action: "dayoff.accepted",
      userId: ctx.userId,
      resourceType: "day_off",
      resourceId: ctx.row.id,
      metadata: { ...dayOffAuditBase(updated), date: ctx.proposal.date, side: ctx.proposal.side },
      request,
    });
    outlookWorker.kick();
    return NextResponse.json(updated);
  } catch (error) {
    return dayOffErrorResponse(error, "Failed to accept Dienstfrei proposal:");
  }
}
