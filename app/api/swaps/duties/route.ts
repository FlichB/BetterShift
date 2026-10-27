import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { getCalendarMembers } from "@/lib/auth/permissions";
import { canManageRotations } from "@/lib/rotation/permissions";
import { swapError, swapErrorResponse, swapsDisabled } from "@/lib/swap/http";
import { canOtherUserSwap, canUseSwaps } from "@/lib/swap/permissions";
import { listDuties } from "@/lib/swap/service";
import type { DutiesResponse, Person } from "@/lib/swap/types";

export async function GET(request: NextRequest) {
  const disabled = swapsDisabled();
  if (disabled) return disabled;
  try {
    const user = await getSessionUser(request.headers);
    const calendarId = request.nextUrl.searchParams.get("calendarId");
    if (!user) return NextResponse.json({ error: "forbidden" }, { status: 401 });
    if (!calendarId) return swapError("invalid");
    // Managers need the member list for the force sheet even without swap rights.
    const allowed = (await canUseSwaps(user.id, calendarId)) || (await canManageRotations(user.id, calendarId));
    if (!allowed) return swapError("forbidden");

    const members: Person[] = [];
    for (const member of (await getCalendarMembers(calendarId)) ?? []) {
      if (await canOtherUserSwap(member.id, calendarId)) members.push({ id: member.id, name: member.name });
    }
    const response: DutiesResponse = { duties: listDuties(calendarId, user.id, new Date()), members };
    return NextResponse.json(response);
  } catch (error) {
    return swapErrorResponse(error, "Failed to load swap duties:");
  }
}
