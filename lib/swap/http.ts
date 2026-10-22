import { NextResponse, type NextRequest } from "next/server";
import { isAuthEnabled } from "@/lib/auth/feature-flags";
import { getSessionUser } from "@/lib/auth/sessions";
import { rateLimit } from "@/lib/rate-limiter";
import { canUseSwaps } from "@/lib/swap/permissions";
import { SwapServiceError, dutyCalendarId, getSwap } from "@/lib/swap/service";
import type { ShiftSwap } from "@/lib/swap/schema";
import type { SwapErrorCode } from "@/lib/swap/types";

const STATUS: Record<SwapErrorCode, number> = {
  notFound: 404,
  forbidden: 403,
  notTarget: 403,
  dutySlotSwapOnly: 403,
  invalid: 400,
  notDuty: 400,
  invalidShift: 400,
  ownOffer: 400,
  notDirect: 400,
  notBroadcast: 400,
  notOpen: 409,
  slotNotOwned: 409,
  alreadyStarted: 409,
  alreadyOnDuty: 409,
  doubleBooked: 409,
  duplicateOffer: 409,
};

export const swapError = (code: SwapErrorCode) => NextResponse.json({ error: code }, { status: STATUS[code] });

/** Maps service errors to `{ error: code }` responses the UI translates via swap.errors.<code>. */
export function swapErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof SwapServiceError) return swapError(error.code);
  console.error(fallback, error);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}

/** Spec B7: without accounts there are no Plätze to own, so the board does not exist. */
export function swapsDisabled(): NextResponse | null {
  return isAuthEnabled() ? null : swapError("notFound");
}

/** Session, offer, calendar permission and rate limit for /api/swaps/[id]/** writes. */
export async function swapWriteContext(
  request: NextRequest,
  id: string,
  options: { allowOfferer?: boolean } = {}
): Promise<{ ok: true; userId: string; calendarId: string; swap: ShiftSwap } | { ok: false; response: NextResponse }> {
  const disabled = swapsDisabled();
  if (disabled) return { ok: false, response: disabled };
  const user = await getSessionUser(request.headers);
  if (!user) return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 401 }) };
  const swap = getSwap(id);
  const calendarId = swap ? dutyCalendarId(swap.offeredShiftId) : null;
  if (!swap || !calendarId) return { ok: false, response: swapError("notFound") };
  // The offerer may always withdraw their own offer, even after losing swap rights.
  const ownOffer = options.allowOfferer && swap.offeredByUserId === user.id;
  if (!ownOffer && !(await canUseSwaps(user.id, calendarId))) return { ok: false, response: swapError("forbidden") };
  const limited = rateLimit(request, user.id, "swap-mutations");
  if (limited) return { ok: false, response: limited };
  return { ok: true, userId: user.id, calendarId, swap };
}
