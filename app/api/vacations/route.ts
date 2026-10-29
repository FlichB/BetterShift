// [fork] Urlaub: the board (GET) and requesting or entering a vacation (POST) (SPEC 12.43).
import { NextRequest, NextResponse } from "next/server";
import { formatDateToLocal } from "@/lib/date-utils";
import { outlookWorker } from "@/lib/outlook/worker";
import { logVacationAction } from "@/lib/vacation/audit";
import { readJson, requireManagerOf, vacationError, vacationErrorResponse, vacationSession } from "@/lib/vacation/http";
import { enterVacation, listBoard, requestVacation } from "@/lib/vacation/service";
import { parseRangeBody } from "@/lib/vacation/validate";

export async function GET(request: NextRequest) {
  try {
    const session = await vacationSession(request, { rateLimited: false });
    if (session instanceof NextResponse) return session;
    const now = new Date();
    const param = request.nextUrl.searchParams.get("year");
    const year = param === null ? Number(formatDateToLocal(now).slice(0, 4)) : Number(param);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return vacationError("invalid");
    return NextResponse.json(await listBoard(session.userId, year, now));
  } catch (error) {
    return vacationErrorResponse(error, "Failed to load vacations:");
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await vacationSession(request);
    if (session instanceof NextResponse) return session;
    const body = await readJson(request);
    const range = parseRangeBody(body);
    if (!range.ok) return vacationError(range.error);
    const now = new Date();
    const target = (body as Record<string, unknown>).userId;
    // An explicit userId is the Verwaltung entering a vacation, also their own (as a Teilnehmer).
    if (typeof target === "string") {
      const denied = await requireManagerOf(session.userId, target);
      if (denied) return denied;
      const entered = await enterVacation(target, range.value, session.userId, now);
      await logVacationAction("vacation.entered", session.userId, entered, request, { note: entered.note });
      outlookWorker.kick();
      return NextResponse.json(entered, { status: 201 });
    }
    const created = await requestVacation(session.userId, range.value, now);
    await logVacationAction("vacation.requested", session.userId, created, request, { note: created.note });
    outlookWorker.kick();
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return vacationErrorResponse(error, "Failed to create vacation:");
  }
}
