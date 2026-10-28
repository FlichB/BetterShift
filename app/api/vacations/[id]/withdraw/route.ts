// [fork] Urlaub: the person withdraws their own pending request (SPEC 12.43).
import { NextRequest, NextResponse } from "next/server";
import { logVacationAction } from "@/lib/vacation/audit";
import { vacationErrorResponse, vacationSession } from "@/lib/vacation/http";
import { withdrawVacation } from "@/lib/vacation/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await vacationSession(request);
    if (session instanceof NextResponse) return session;
    const updated = await withdrawVacation(id, session.userId, new Date());
    await logVacationAction("vacation.withdrawn", session.userId, updated, request);
    return NextResponse.json(updated);
  } catch (error) {
    return vacationErrorResponse(error, "Failed to withdraw vacation:");
  }
}
