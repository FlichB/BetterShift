// [fork] Urlaub: Werktage a requested vacation would leave understaffed (SPEC 12.44). Read-only.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formatDateToLocal } from "@/lib/date-utils";
import { approvedRanges } from "@/lib/vacation/dates";
import { readJson, requireManagerOf, vacationError, vacationErrorResponse, vacationSession } from "@/lib/vacation/http";
import { staffingGaps } from "@/lib/vacation/staffing";
import { parseRangeBody } from "@/lib/vacation/validate";

export async function POST(request: NextRequest) {
  try {
    // A read like the board GET; the sheet re-queries on every date edit.
    const session = await vacationSession(request, { rateLimited: false });
    if (session instanceof NextResponse) return session;
    const body = await readJson(request);
    const parsed = parseRangeBody(body);
    if (!parsed.ok) return vacationError("invalid");
    const raw = (body as { userId?: unknown }).userId;
    const userId = typeof raw === "string" && raw !== "" ? raw : session.userId;
    if (userId !== session.userId) {
      const denied = await requireManagerOf(session.userId, userId);
      if (denied) return denied;
    }
    const target = { from: parsed.value.startDate, to: parsed.value.endDate };
    const ranges = [...(approvedRanges(db, [userId]).get(userId) ?? []), target];
    return NextResponse.json({ gaps: staffingGaps(db, userId, ranges, target, formatDateToLocal(new Date())) });
  } catch (error) {
    return vacationErrorResponse(error, "Failed to check vacation staffing:");
  }
}
