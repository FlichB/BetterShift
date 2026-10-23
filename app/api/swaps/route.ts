import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/sessions";
import { logUserAction } from "@/lib/audit-log";
import { rateLimit } from "@/lib/rate-limiter";
import { outlookWorker } from "@/lib/outlook/worker";
import { readJson } from "@/lib/rotation/http";
import { shiftDate, swapAuditBase, type SwapOfferedMetadata } from "@/lib/swap/audit";
import { swapError, swapErrorResponse, swapsDisabled } from "@/lib/swap/http";
import { canOtherUserSwap, canUseSwaps, swapCalendarIds } from "@/lib/swap/permissions";
import { createOffer, dutyCalendarId, listBoard } from "@/lib/swap/service";
import { validateOffer } from "@/lib/swap/validate";
import type { Board } from "@/lib/swap/types";

export async function GET(request: NextRequest) {
  const disabled = swapsDisabled();
  if (disabled) return disabled;
  try {
    const user = await getSessionUser(request.headers);
    if (!user) return NextResponse.json({ error: "forbidden" }, { status: 401 });
    const calendarIds = await swapCalendarIds(user.id);
    const includeHidden = request.nextUrl.searchParams.get("hidden") === "1";
    const names =
      calendarIds.length === 0
        ? []
        : db.select({ id: calendars.id, name: calendars.name }).from(calendars).where(inArray(calendars.id, calendarIds)).all();
    const board: Board = { calendars: names, ...listBoard(user.id, calendarIds, new Date(), includeHidden) };
    return NextResponse.json(board);
  } catch (error) {
    return swapErrorResponse(error, "Failed to load swap board:");
  }
}

export async function POST(request: NextRequest) {
  const disabled = swapsDisabled();
  if (disabled) return disabled;
  try {
    const user = await getSessionUser(request.headers);
    if (!user) return NextResponse.json({ error: "forbidden" }, { status: 401 });
    const rateLimitResponse = rateLimit(request, user.id, "swap-mutations");
    if (rateLimitResponse) return rateLimitResponse;

    const parsed = validateOffer(await readJson(request));
    if (!parsed.ok) return swapError("invalid");
    const input = parsed.value;
    const calendarId = dutyCalendarId(input.shiftId);
    if (!calendarId) return swapError("notDuty");
    if (!(await canUseSwaps(user.id, calendarId))) return swapError("forbidden");
    if (input.targetUserId && !(await canOtherUserSwap(input.targetUserId, calendarId))) return swapError("invalid");

    const swap = createOffer(input, user.id, new Date());
    await logUserAction<SwapOfferedMetadata>({
      action: "swap.offered",
      userId: user.id,
      resourceType: "shift_swap",
      resourceId: swap.id,
      metadata: { ...swapAuditBase(swap), targetUserId: swap.targetUserId, requestedDate: shiftDate(swap.requestedShiftId) },
      request,
    });
    outlookWorker.kick();
    return NextResponse.json(swap, { status: 201 });
  } catch (error) {
    return swapErrorResponse(error, "Failed to create swap offer:");
  }
}
