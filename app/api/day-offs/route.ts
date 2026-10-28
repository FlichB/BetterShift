// [fork] Dienstfrei API route.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { canMoveOwnDayOff } from "@/lib/dayoff/permissions";
import { dayOffErrorResponse } from "@/lib/dayoff/http";
import { listDayOffBoard } from "@/lib/dayoff/service";
import { swapsDisabled } from "@/lib/swap/http";
import { manageCalendarIds } from "@/lib/swap/permissions";

export async function GET(request: NextRequest) {
  const disabled = swapsDisabled();
  if (disabled) return disabled;
  try {
    const user = await getSessionUser(request.headers);
    if (!user) return NextResponse.json({ error: "forbidden" }, { status: 401 });
    const board = listDayOffBoard(user.id, await manageCalendarIds(user.id), new Date());
    const canMoveByCalendar = new Map<string, boolean>();
    for (const view of board.mine) {
      if (!canMoveByCalendar.has(view.calendarId)) canMoveByCalendar.set(view.calendarId, await canMoveOwnDayOff(user.id, view.calendarId));
      view.canMove = canMoveByCalendar.get(view.calendarId) ?? false;
    }
    return NextResponse.json(board);
  } catch (error) {
    return dayOffErrorResponse(error, "Failed to load Dienstfrei board:");
  }
}
