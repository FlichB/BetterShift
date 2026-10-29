// [fork] Urlaub: dry-run of an action on the person's rotations (SPEC 12.43).
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { previewAction } from "@/lib/vacation/replan";
import { readJson, requireManagerOf, vacationError, vacationErrorResponse, vacationSession } from "@/lib/vacation/http";
import { vacationChanges, vacations } from "@/lib/vacation/schema";
import { parsePreviewAction } from "@/lib/vacation/validate";

export async function POST(request: NextRequest) {
  try {
    const session = await vacationSession(request);
    if (session instanceof NextResponse) return session;
    const parsed = parsePreviewAction(await readJson(request));
    if (!parsed.ok) return vacationError(parsed.error);
    const action = parsed.value;

    let holderId: string | undefined;
    if (action.kind === "enter") holderId = action.userId;
    else if (action.kind === "approveChange") {
      const change = db.select().from(vacationChanges).where(eq(vacationChanges.id, action.changeId)).get();
      holderId = change ? db.select().from(vacations).where(eq(vacations.id, change.vacationId)).get()?.userId : undefined;
    } else {
      holderId = db.select().from(vacations).where(eq(vacations.id, action.vacationId)).get()?.userId;
    }
    if (!holderId) return vacationError("notFound");

    const denied = await requireManagerOf(session.userId, holderId);
    if (denied) return denied;
    return NextResponse.json(await previewAction(action, new Date()));
  } catch (error) {
    return vacationErrorResponse(error, "Failed to preview vacation:");
  }
}
