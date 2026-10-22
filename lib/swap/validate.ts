import type { OfferInput } from "@/lib/swap/service";

export type Validated<T> = { ok: true; value: T } | { ok: false; error: "invalid" };

const MAX_ID = 100;
const MAX_NOTE = 200;
const invalid = { ok: false, error: "invalid" } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID;
/** undefined/null → null, a valid id → the id, anything else → undefined (invalid) */
const optionalId = (v: unknown): string | null | undefined => (v == null ? null : isId(v) ? v : undefined);

export function validateOffer(body: unknown): Validated<OfferInput> {
  if (!isRecord(body) || !isId(body.shiftId)) return invalid;
  if (body.type !== "give" && body.type !== "exchange") return invalid;
  const targetUserId = optionalId(body.targetUserId);
  const requestedShiftId = optionalId(body.requestedShiftId);
  if (targetUserId === undefined || requestedShiftId === undefined) return invalid;
  if (body.type === "give" && requestedShiftId) return invalid;
  if (body.note != null && typeof body.note !== "string") return invalid;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > MAX_NOTE) return invalid;
  return {
    ok: true,
    value: { shiftId: body.shiftId, type: body.type, targetUserId, requestedShiftId, note: note || null },
  };
}

export function validateAccept(body: unknown): Validated<{ shiftId: string | null }> {
  if (body == null) return { ok: true, value: { shiftId: null } };
  if (!isRecord(body)) return invalid;
  const shiftId = optionalId(body.shiftId);
  if (shiftId === undefined) return invalid;
  return { ok: true, value: { shiftId } };
}
