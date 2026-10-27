import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { hasCapability } from "@/lib/auth/permissions";
import { swapError, swapErrorResponse, swapsDisabled } from "@/lib/swap/http";
import { canManageRotations } from "@/lib/rotation/permissions";
import { calendarState } from "@/lib/swap/service";
import type { CalendarSwapState } from "@/lib/swap/types";

export async function GET(request: NextRequest) {
  const disabled = swapsDisabled();
  if (disabled) return disabled;
  try {
    const calendarId = request.nextUrl.searchParams.get("calendarId");
    if (!calendarId) return swapError("invalid");
    const user = await getSessionUser(request.headers);
    if (!(await hasCapability(user?.id, calendarId, "viewShifts"))) return swapError("forbidden");
    const canForce = Boolean(user) && (await canManageRotations(user!.id, calendarId));
    const state: CalendarSwapState = { ...calendarState(calendarId, new Date()), canForce };
    return NextResponse.json(state);
  } catch (error) {
    return swapErrorResponse(error, "Failed to load swap calendar state:");
  }
}
