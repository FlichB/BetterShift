import type { ForceInput, OfferInput } from "@/lib/swap/service";

export type Validated<T> = { ok: true; value: T } | { ok: false; error: "invalid" };

const MAX_ID = 100;
const MAX_NOTE = 200;
const MAX_REASON = 500;
const invalid = { ok: false, error: "invalid" } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID;
/** undefined/null → null, a valid id → the id, anything else → undefined (invalid) */
const optionalId = (v: unknown): string | null | undefined => (v == null ? null : isId(v) ? v : undefined);

/** undefined/null → null, a short string → trimmed (empty → null), anything else → undefined (invalid) */
function parseNote(v: unknown): string | null | undefined {
  if (v == null) return null;
  if (typeof v !== "string") return undefined;
  const note = v.trim();
  return note.length > MAX_NOTE ? undefined : note || null;
}

export function validateOffer(body: unknown): Validated<OfferInput> {
  if (!isRecord(body) || !isId(body.shiftId)) return invalid;
  if (body.type !== "exchange") return invalid;
  const targetUserId = optionalId(body.targetUserId);
  const requestedShiftId = optionalId(body.requestedShiftId);
  const note = parseNote(body.note);
  if (targetUserId === undefined || requestedShiftId === undefined || note === undefined) return invalid;
  return {
    ok: true,
    value: { shiftId: body.shiftId, type: body.type, targetUserId, requestedShiftId, note },
  };
}

export function validateAccept(body: unknown): Validated<{ shiftId: string | null }> {
  if (body == null) return { ok: true, value: { shiftId: null } };
  if (!isRecord(body)) return invalid;
  const shiftId = optionalId(body.shiftId);
  if (shiftId === undefined) return invalid;
  return { ok: true, value: { shiftId } };
}

export function validateForce(body: unknown): Validated<ForceInput> {
  if (!isRecord(body) || !isId(body.shiftId) || !isId(body.absentUserId)) return invalid;
  const substituteUserId = optionalId(body.substituteUserId);
  const note = parseNote(body.note);
  if (substituteUserId === undefined || note === undefined) return invalid;
  return { ok: true, value: { shiftId: body.shiftId, absentUserId: body.absentUserId, substituteUserId, note } };
}

export function validateCounter(body: unknown): Validated<{ shiftId: string }> {
  if (!isRecord(body) || !isId(body.shiftId)) return invalid;
  return { ok: true, value: { shiftId: body.shiftId } };
}

export function validateWaive(body: unknown): Validated<{ reason: string }> {
  if (!isRecord(body) || typeof body.reason !== "string") return invalid;
  const reason = body.reason.trim();
  if (reason.length === 0 || reason.length > MAX_REASON) return invalid;
  return { ok: true, value: { reason } };
}
