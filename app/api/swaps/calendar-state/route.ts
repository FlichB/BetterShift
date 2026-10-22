import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { hasCapability } from "@/lib/auth/permissions";
import { swapError, swapErrorResponse, swapsDisabled } from "@/lib/swap/http";
import { calendarState } from "@/lib/swap/service";

export async function GET(request: NextRequest) {
  const disabled = swapsDisabled();
  if (disabled) return disabled;
  try {
    const calendarId = request.nextUrl.searchParams.get("calendarId");
    if (!calendarId) return swapError("invalid");
    const user = await getSessionUser(request.headers);
    if (!(await hasCapability(user?.id, calendarId, "viewShifts"))) return swapError("forbidden");
    return NextResponse.json(calendarState(calendarId, new Date()));
  } catch (error) {
    return swapErrorResponse(error, "Failed to load swap calendar state:");
  }
}
