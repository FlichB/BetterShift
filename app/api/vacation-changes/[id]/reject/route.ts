// [fork] Urlaub: the Verwaltung rejects a change or cancel request with a reason (SPEC 12.43).
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { outlookWorker } from "@/lib/outlook/worker";
import { logVacationAction } from "@/lib/vacation/audit";
import { readJson, requireManagerOf, vacationError, vacationErrorResponse, vacationSession } from "@/lib/vacation/http";
import { vacationChanges, vacations } from "@/lib/vacation/schema";
import { rejectChange } from "@/lib/vacation/service";
import { parseNote } from "@/lib/vacation/validate";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await vacationSession(request);
    if (session instanceof NextResponse) return session;
    const change = db.select().from(vacationChanges).where(eq(vacationChanges.id, id)).get();
    const vacation = change ? db.select().from(vacations).where(eq(vacations.id, change.vacationId)).get() : null;
    if (!change || !vacation) return vacationError("notFound");
    const denied = await requireManagerOf(session.userId, vacation.userId);
    if (denied) return denied;
    const body = await readJson(request);
    const note = parseNote(typeof body === "object" && body !== null ? (body as Record<string, unknown>).note : undefined, true);
    if (!note.ok) return vacationError(note.error);
    const updated = await rejectChange(id, session.userId, note.value!, new Date());
    await logVacationAction("vacation.change_rejected", session.userId, vacation, request, { changeKind: change.kind, note: note.value });
    outlookWorker.kick();
    return NextResponse.json(updated);
  } catch (error) {
    return vacationErrorResponse(error, "Failed to reject vacation change:");
  }
}
