import { NextRequest, NextResponse } from "next/server";
import { logUserAction } from "@/lib/audit-log";
import { readJson } from "@/lib/rotation/http";
import { swapAuditBase, type SwapCounterWaivedMetadata } from "@/lib/swap/audit";
import { swapError, swapErrorResponse, swapManageContext } from "@/lib/swap/http";
import { waiveCounter } from "@/lib/swap/service";
import { validateWaive } from "@/lib/swap/validate";

// [fork] Spec D8: only the management may release an Einspringer from the Ausgleich.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await swapManageContext(request, id);
    if (!ctx.ok) return ctx.response;
    const parsed = validateWaive(await readJson(request));
    if (!parsed.ok) return swapError("invalid");

    const swap = waiveCounter(id, parsed.value.reason, ctx.userId, new Date());
    await logUserAction<SwapCounterWaivedMetadata>({
      action: "swap.counter_waived",
      userId: ctx.userId,
      resourceType: "shift_swap",
      resourceId: id,
      metadata: { ...swapAuditBase(swap), substituteUserId: swap.acceptedByUserId, reason: parsed.value.reason },
      request,
    });
    return NextResponse.json(swap);
  } catch (error) {
    return swapErrorResponse(error, "Failed to waive counter duty:");
  }
}
