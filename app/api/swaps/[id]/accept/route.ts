import { NextRequest, NextResponse } from "next/server";
import { logUserAction } from "@/lib/audit-log";
import { readJson } from "@/lib/rotation/http";
import { shiftDate, swapAuditBase, type SwapAcceptedMetadata } from "@/lib/swap/audit";
import { swapError, swapErrorResponse, swapWriteContext } from "@/lib/swap/http";
import { acceptOffer } from "@/lib/swap/service";
import { validateAccept } from "@/lib/swap/validate";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await swapWriteContext(request, id);
    if (!ctx.ok) return ctx.response;
    const parsed = validateAccept(await readJson(request));
    if (!parsed.ok) return swapError("invalid");

    const result = acceptOffer(id, ctx.userId, parsed.value.shiftId, new Date());
    await logUserAction<SwapAcceptedMetadata>({
      action: "swap.accepted",
      userId: ctx.userId,
      resourceType: "shift_swap",
      resourceId: id,
      metadata: {
        ...swapAuditBase(result.swap),
        acceptedByUserId: ctx.userId,
        acceptedDate: shiftDate(result.swap.acceptedShiftId),
        moves: result.moves,
      },
      request,
    });
    return NextResponse.json({ moves: result.moves });
  } catch (error) {
    return swapErrorResponse(error, "Failed to accept swap offer:");
  }
}
