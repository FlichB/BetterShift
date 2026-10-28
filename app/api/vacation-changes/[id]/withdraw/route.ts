// [fork] Urlaub: the person withdraws their own pending change request (SPEC 12.43).
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { logVacationAction } from "@/lib/vacation/audit";
import { vacationError, vacationErrorResponse, vacationSession } from "@/lib/vacation/http";
import { vacations } from "@/lib/vacation/schema";
import { withdrawChange } from "@/lib/vacation/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await vacationSession(request);
    if (session instanceof NextResponse) return session;
    const updated = await withdrawChange(id, session.userId, new Date());
    const vacation = db.select().from(vacations).where(eq(vacations.id, updated.vacationId)).get();
    if (!vacation) return vacationError("notFound");
    await logVacationAction("vacation.change_withdrawn", session.userId, vacation, request, { changeKind: updated.kind });
    return NextResponse.json(updated);
  } catch (error) {
    return vacationErrorResponse(error, "Failed to withdraw vacation change:");
  }
}
