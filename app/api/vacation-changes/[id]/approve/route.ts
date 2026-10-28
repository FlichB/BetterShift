// [fork] Urlaub: the Verwaltung approves a change or cancel request and the rotations are replanned (SPEC 12.43).
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { outlookWorker } from "@/lib/outlook/worker";
import { logVacationAction } from "@/lib/vacation/audit";
import { requireManagerOf, vacationError, vacationErrorResponse, vacationSession } from "@/lib/vacation/http";
import { vacationChanges, vacations } from "@/lib/vacation/schema";
import { approveChange } from "@/lib/vacation/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await vacationSession(request);
    if (session instanceof NextResponse) return session;
    const change = db.select().from(vacationChanges).where(eq(vacationChanges.id, id)).get();
    const before = change ? db.select().from(vacations).where(eq(vacations.id, change.vacationId)).get() : null;
    if (!change || !before) return vacationError("notFound");
    const denied = await requireManagerOf(session.userId, before.userId);
    if (denied) return denied;
    const updated = await approveChange(id, session.userId, new Date());
    const after = db.select().from(vacations).where(eq(vacations.id, before.id)).get() ?? before;
    await logVacationAction("vacation.change_approved", session.userId, after, request, {
      changeKind: change.kind,
      previousStart: before.startDate,
      previousEnd: before.endDate,
    });
    outlookWorker.kick();
    return NextResponse.json(updated);
  } catch (error) {
    return vacationErrorResponse(error, "Failed to approve vacation change:");
  }
}
