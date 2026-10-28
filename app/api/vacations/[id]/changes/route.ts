// [fork] Urlaub: the person asks to change or cancel an approved vacation (SPEC 12.43).
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { outlookWorker } from "@/lib/outlook/worker";
import { logVacationAction } from "@/lib/vacation/audit";
import { readJson, vacationError, vacationErrorResponse, vacationSession } from "@/lib/vacation/http";
import { vacations } from "@/lib/vacation/schema";
import { requestChange } from "@/lib/vacation/service";
import { parseNote, parseRangeBody } from "@/lib/vacation/validate";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await vacationSession(request);
    if (session instanceof NextResponse) return session;
    const body = await readJson(request);
    if (typeof body !== "object" || body === null) return vacationError("invalid");
    const raw = body as Record<string, unknown>;
    const kind = raw.kind;
    if (kind !== "change" && kind !== "cancel") return vacationError("invalid");

    let startDate: string | undefined;
    let endDate: string | undefined;
    let note: string | null;
    if (kind === "change") {
      const range = parseRangeBody(raw);
      if (!range.ok) return vacationError(range.error);
      ({ startDate, endDate, note } = range.value);
    } else {
      const parsed = parseNote(raw.note, false);
      if (!parsed.ok) return vacationError(parsed.error);
      note = parsed.value;
    }

    const change = await requestChange(id, session.userId, { kind, startDate, endDate, note }, new Date());
    const vacation = db.select().from(vacations).where(eq(vacations.id, id)).get();
    if (vacation) await logVacationAction("vacation.change_requested", session.userId, vacation, request, { changeKind: kind, note });
    outlookWorker.kick();
    return NextResponse.json(change, { status: 201 });
  } catch (error) {
    return vacationErrorResponse(error, "Failed to request vacation change:");
  }
}
