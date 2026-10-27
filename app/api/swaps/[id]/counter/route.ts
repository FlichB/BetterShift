import { NextRequest, NextResponse } from "next/server";
import { logUserAction } from "@/lib/audit-log";
import { outlookWorker } from "@/lib/outlook/worker";
import { readJson } from "@/lib/rotation/http";
import { shiftDate, swapAuditBase, type SwapCounterChosenMetadata } from "@/lib/swap/audit";
import { swapError, swapErrorResponse, swapManageContext } from "@/lib/swap/http";
import { chooseCounter } from "@/lib/swap/service";
import { validateCounter } from "@/lib/swap/validate";

// [fork] Spec D6/D8: the Einspringer, or the management on their behalf, picks the counter duty.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await swapManageContext(request, id, { allowSubstitute: true });
    if (!ctx.ok) return ctx.response;
    const parsed = validateCounter(await readJson(request));
    if (!parsed.ok) return swapError("invalid");

    const result = chooseCounter(id, parsed.value.shiftId, ctx.userId, new Date());
    await logUserAction<SwapCounterChosenMetadata>({
      action: "swap.counter_chosen",
      userId: ctx.userId,
      resourceType: "shift_swap",
      resourceId: id,
      metadata: {
        ...swapAuditBase(result.swap),
        substituteUserId: result.swap.acceptedByUserId,
        chosenByUserId: ctx.userId,
        counterDate: shiftDate(result.swap.acceptedShiftId),
        moves: result.moves,
      },
      request,
    });
    outlookWorker.kick();
    return NextResponse.json({ moves: result.moves });
  } catch (error) {
    return swapErrorResponse(error, "Failed to choose counter duty:");
  }
}
