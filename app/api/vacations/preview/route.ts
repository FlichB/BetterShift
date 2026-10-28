// [fork] Urlaub: dry-run of an action on the person's rotations (SPEC 12.43).
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { previewAction } from "@/lib/vacation/replan";
import { readJson, requireManagerOf, vacationError, vacationErrorResponse, vacationSession } from "@/lib/vacation/http";
import { vacationChanges, vacations } from "@/lib/vacation/schema";
import type { VacationAction } from "@/lib/vacation/types";
import { parseRangeBody } from "@/lib/vacation/validate";

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function POST(request: NextRequest) {
  try {
    const session = await vacationSession(request);
    if (session instanceof NextResponse) return session;
    const body = await readJson(request);
    if (typeof body !== "object" || body === null) return vacationError("invalid");
    const raw = body as Record<string, unknown>;

    let action: VacationAction;
    let holderId: string;
    switch (raw.kind) {
      case "enter": {
        const userId = str(raw.userId);
        const range = parseRangeBody(raw);
        if (!userId) return vacationError("invalid");
        if (!range.ok) return vacationError(range.error);
        action = { kind: "enter", userId, startDate: range.value.startDate, endDate: range.value.endDate };
        holderId = userId;
        break;
      }
      case "approve":
      case "cancel":
      case "change": {
        const vacationId = str(raw.vacationId);
        if (!vacationId) return vacationError("invalid");
        const row = db.select().from(vacations).where(eq(vacations.id, vacationId)).get();
        if (!row) return vacationError("notFound");
        holderId = row.userId;
        if (raw.kind === "change") {
          const range = parseRangeBody(raw);
          if (!range.ok) return vacationError(range.error);
          action = { kind: "change", vacationId, startDate: range.value.startDate, endDate: range.value.endDate };
        } else {
          action = { kind: raw.kind, vacationId };
        }
        break;
      }
      case "approveChange": {
        const changeId = str(raw.changeId);
        if (!changeId) return vacationError("invalid");
        const change = db.select().from(vacationChanges).where(eq(vacationChanges.id, changeId)).get();
        const row = change ? db.select().from(vacations).where(eq(vacations.id, change.vacationId)).get() : null;
        if (!row) return vacationError("notFound");
        holderId = row.userId;
        action = { kind: "approveChange", changeId };
        break;
      }
      default:
        return vacationError("invalid");
    }

    const denied = await requireManagerOf(session.userId, holderId);
    if (denied) return denied;
    return NextResponse.json(await previewAction(action, new Date()));
  } catch (error) {
    return vacationErrorResponse(error, "Failed to preview vacation:");
  }
}
