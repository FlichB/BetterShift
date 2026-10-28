// [fork] Error mapping and request context for the Dienstfrei routes.
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/sessions";
import { dayOffProposals, dayOffs, type DayOff, type DayOffProposal } from "@/lib/dayoff/schema";
import { DayOffServiceError } from "@/lib/dayoff/service";
import type { DayOffErrorCode } from "@/lib/dayoff/types";
import { rateLimit } from "@/lib/rate-limiter";
import { canManageRotations } from "@/lib/rotation/permissions";
import { rotations } from "@/lib/rotation/schema";
import { swapsDisabled } from "@/lib/swap/http";

export const STATUS: Record<DayOffErrorCode, number> = {
  notFound: 404,
  forbidden: 403,
  notHolder: 403,
  invalid: 400,
  reasonRequired: 400,
  wrongStatus: 409,
  alreadyStarted: 409,
  notWorkday: 409,
  outsideWeek: 409,
  outsideWindow: 409,
  taken: 409,
  duplicate: 409,
  tooMany: 409,
  proposalNotOpen: 409,
  belowMinimum: 409,
};

export const dayOffError = (code: DayOffErrorCode) => NextResponse.json({ error: code }, { status: STATUS[code] });

/** Maps service errors to `{ error: code }` responses the UI translates via dayOff.errors.<code>. */
export function dayOffErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof DayOffServiceError) return dayOffError(error.code);
  console.error(fallback, error);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}

export type DayOffContext = { userId: string; row: DayOff; calendarId: string; isHolder: boolean; isManager: boolean };
export type ProposalContext = DayOffContext & { proposal: DayOffProposal };

async function contextFor(
  request: NextRequest,
  load: () => { row: DayOff; proposal?: DayOffProposal } | null,
  rateLimited: boolean
): Promise<(DayOffContext & { proposal?: DayOffProposal }) | NextResponse> {
  const disabled = swapsDisabled();
  if (disabled) return disabled;
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  const loaded = load();
  if (!loaded) return dayOffError("notFound");
  const rotation = db.select({ calendarId: rotations.calendarId }).from(rotations).where(eq(rotations.id, loaded.row.rotationId)).get();
  if (!rotation) return dayOffError("notFound");
  const isHolder = loaded.row.userId === user.id;
  const isManager = await canManageRotations(user.id, rotation.calendarId);
  if (!isHolder && !isManager) return dayOffError("forbidden");
  if (rateLimited) {
    const limited = rateLimit(request, user.id, "swap-mutations");
    if (limited) return limited;
  }
  return { userId: user.id, row: loaded.row, calendarId: rotation.calendarId, isHolder, isManager, proposal: loaded.proposal };
}

/** Session, Dienstfrei, holder-or-manager check and rate limit for /api/day-offs/[id]/**. */
export async function dayOffContext(
  request: NextRequest,
  id: string,
  { rateLimited = true }: { rateLimited?: boolean } = {}
): Promise<DayOffContext | NextResponse> {
  const result = await contextFor(request, () => {
    const row = db.select().from(dayOffs).where(eq(dayOffs.id, id)).get();
    return row ? { row } : null;
  }, rateLimited);
  return result;
}

/** Same for /api/day-offs/proposals/[id]/**: resolves the proposal's Dienstfrei first. */
export async function proposalContext(request: NextRequest, proposalId: string): Promise<ProposalContext | NextResponse> {
  const result = await contextFor(request, () => {
    const proposal = db.select().from(dayOffProposals).where(eq(dayOffProposals.id, proposalId)).get();
    if (!proposal) return null;
    const row = db.select().from(dayOffs).where(eq(dayOffs.id, proposal.dayOffId)).get();
    return row ? { row, proposal } : null;
  }, true);
  if (result instanceof NextResponse) return result;
  return result as ProposalContext;
}
