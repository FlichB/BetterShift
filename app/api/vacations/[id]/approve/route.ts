// [fork] Urlaub: the Verwaltung approves a request and the person's rotations are replanned (SPEC 12.43).
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { outlookWorker } from "@/lib/outlook/worker";
import { logVacationAction } from "@/lib/vacation/audit";
import { requireManagerOf, vacationError, vacationErrorResponse, vacationSession } from "@/lib/vacation/http";
import { vacations } from "@/lib/vacation/schema";
import { approveVacation } from "@/lib/vacation/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await vacationSession(request);
    if (session instanceof NextResponse) return session;
    const row = db.select().from(vacations).where(eq(vacations.id, id)).get();
    if (!row) return vacationError("notFound");
    const denied = await requireManagerOf(session.userId, row.userId);
    if (denied) return denied;
    const updated = await approveVacation(id, session.userId, new Date());
    await logVacationAction("vacation.approved", session.userId, updated, request);
    outlookWorker.kick();
    return NextResponse.json(updated);
  } catch (error) {
    return vacationErrorResponse(error, "Failed to approve vacation:");
  }
}
