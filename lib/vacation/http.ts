// [fork] Error mapping and request context for the Urlaub routes.
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/sessions";
import { rateLimit } from "@/lib/rate-limiter";
import { RotationServiceError } from "@/lib/rotation/service";
import { swapsDisabled } from "@/lib/swap/http";
import { VacationServiceError } from "@/lib/vacation/errors";
import { isManagerOf } from "@/lib/vacation/permissions";
import type { VacationErrorCode } from "@/lib/vacation/types";

export const STATUS: Record<VacationErrorCode, number> = {
  notFound: 404,
  forbidden: 403,
  invalid: 400,
  reasonRequired: 400,
  tooLong: 400,
  notParticipant: 409,
  begun: 409,
  overlap: 409,
  wrongStatus: 409,
  changePending: 409,
  rotationUnavailable: 409,
};

export const vacationError = (code: VacationErrorCode) => NextResponse.json({ error: code }, { status: STATUS[code] });

/** Maps service errors to `{ error: code }` responses the UI translates via vacation.errors.<code>. */
export function vacationErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof VacationServiceError) return vacationError(error.code);
  // A rotation of the person cannot be planned (preset gone or archived, sign-ups off).
  if (error instanceof RotationServiceError) return vacationError("rotationUnavailable");
  console.error(fallback, error);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}

export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Session and optional rate limit; Urlaub needs auth like the swap board. */
export async function vacationSession(
  request: NextRequest,
  { rateLimited = true }: { rateLimited?: boolean } = {}
): Promise<{ userId: string } | NextResponse> {
  const disabled = swapsDisabled();
  if (disabled) return disabled;
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (rateLimited) {
    const limited = rateLimit(request, user.id, "swap-mutations");
    if (limited) return limited;
  }
  return { userId: user.id };
}

export async function requireManagerOf(actorId: string, userId: string): Promise<NextResponse | null> {
  return (await isManagerOf(actorId, userId)) ? null : vacationError("forbidden");
}
