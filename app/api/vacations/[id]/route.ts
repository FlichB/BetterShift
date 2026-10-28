// [fork] Urlaub: the Verwaltung changes or cancels an approved vacation directly (SPEC 12.43).
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { outlookWorker } from "@/lib/outlook/worker";
import { logVacationAction } from "@/lib/vacation/audit";
import { readJson, requireManagerOf, vacationError, vacationErrorResponse, vacationSession } from "@/lib/vacation/http";
import { vacations } from "@/lib/vacation/schema";
import { cancelVacation, changeVacation } from "@/lib/vacation/service";
import { parseRangeBody } from "@/lib/vacation/validate";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await vacationSession(request);
    if (session instanceof NextResponse) return session;
    const row = db.select().from(vacations).where(eq(vacations.id, id)).get();
    if (!row) return vacationError("notFound");
    const denied = await requireManagerOf(session.userId, row.userId);
    if (denied) return denied;
    const range = parseRangeBody(await readJson(request));
    if (!range.ok) return vacationError(range.error);
    const updated = await changeVacation(id, { startDate: range.value.startDate, endDate: range.value.endDate }, session.userId, new Date());
    await logVacationAction("vacation.changed", session.userId, updated, request, { previousStart: row.startDate, previousEnd: row.endDate });
    outlookWorker.kick();
    return NextResponse.json(updated);
  } catch (error) {
    return vacationErrorResponse(error, "Failed to change vacation:");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await vacationSession(request);
    if (session instanceof NextResponse) return session;
    const row = db.select().from(vacations).where(eq(vacations.id, id)).get();
    if (!row) return vacationError("notFound");
    const denied = await requireManagerOf(session.userId, row.userId);
    if (denied) return denied;
    const cancelled = await cancelVacation(id, session.userId, new Date());
    await logVacationAction("vacation.cancelled", session.userId, cancelled, request);
    outlookWorker.kick();
    return NextResponse.json(cancelled);
  } catch (error) {
    return vacationErrorResponse(error, "Failed to cancel vacation:");
  }
}
