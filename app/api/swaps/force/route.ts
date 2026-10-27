import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { logUserAction } from "@/lib/audit-log";
import { rateLimit } from "@/lib/rate-limiter";
import { outlookWorker } from "@/lib/outlook/worker";
import { canManageRotations } from "@/lib/rotation/permissions";
import { readJson } from "@/lib/rotation/http";
import { swapAuditBase, type SwapForcedMetadata } from "@/lib/swap/audit";
import { swapError, swapErrorResponse, swapsDisabled } from "@/lib/swap/http";
import { canOtherUserSwap } from "@/lib/swap/permissions";
import { dutyCalendarId, forceSwap } from "@/lib/swap/service";
import { validateForce } from "@/lib/swap/validate";

// [fork] Spec D3–D5: the management hands an absent user's Platz to an Einspringer.
export async function POST(request: NextRequest) {
  const disabled = swapsDisabled();
  if (disabled) return disabled;
  try {
    const user = await getSessionUser(request.headers);
    if (!user) return NextResponse.json({ error: "forbidden" }, { status: 401 });
    const limited = rateLimit(request, user.id, "swap-mutations");
    if (limited) return limited;

    const parsed = validateForce(await readJson(request));
    if (!parsed.ok) return swapError("invalid");
    const input = parsed.value;
    const calendarId = dutyCalendarId(input.shiftId);
    if (!calendarId) return swapError("notDuty");
    if (!(await canManageRotations(user.id, calendarId))) return swapError("forbidden");
    if (input.substituteUserId && !(await canOtherUserSwap(input.substituteUserId, calendarId))) return swapError("invalid");

    const result = forceSwap(input, user.id, new Date());
    await logUserAction<SwapForcedMetadata>({
      action: "swap.forced",
      userId: user.id,
      resourceType: "shift_swap",
      resourceId: result.swap.id,
      metadata: { ...swapAuditBase(result.swap), forcedByUserId: user.id, substituteUserId: input.substituteUserId, moves: result.moves },
      request,
    });
    outlookWorker.kick();
    return NextResponse.json({ moves: result.moves }, { status: 201 });
  } catch (error) {
    return swapErrorResponse(error, "Failed to force swap:");
  }
}
