import { NextResponse } from "next/server";
import { RotationServiceError } from "@/lib/rotation/service";

const STATUS: Record<RotationServiceError["code"], number> = {
  notFound: 404,
  presetMissing: 400,
  presetArchived: 400,
  signupsDisabled: 400,
  notMember: 400, // [fork] Jahresausgleich
};

/** Maps service errors to `{ error: code }` responses the UI translates via rotation.errors.<code>. */
export function rotationErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof RotationServiceError) {
    return NextResponse.json({ error: error.code }, { status: STATUS[error.code] });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}

/** Parses a JSON body; malformed JSON becomes `undefined` so validators answer 400 instead of a 500. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
