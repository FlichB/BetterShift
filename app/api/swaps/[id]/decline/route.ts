import { NextRequest, NextResponse } from "next/server";
import { logUserAction } from "@/lib/audit-log";
import { swapAuditBase, type SwapResolvedMetadata } from "@/lib/swap/audit";
import { swapErrorResponse, swapWriteContext } from "@/lib/swap/http";
import { declineOffer } from "@/lib/swap/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await swapWriteContext(request, id);
    if (!ctx.ok) return ctx.response;
    const swap = declineOffer(id, ctx.userId, new Date());
    await logUserAction<SwapResolvedMetadata>({
      action: "swap.declined",
      userId: ctx.userId,
      resourceType: "shift_swap",
      resourceId: id,
      metadata: swapAuditBase(swap),
      request,
    });
    return NextResponse.json(swap);
  } catch (error) {
    return swapErrorResponse(error, "Failed to decline swap offer:");
  }
}
