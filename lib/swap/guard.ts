// [fork] Spec 12.18: Plätze of generated duties change hands only through the
// swap board. Whoever may sign up others can still reassign by hand (12.17).
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rotationDuties } from "@/lib/rotation/schema";

export function isRotationDuty(shiftId: string): boolean {
  return Boolean(
    db.select({ shiftId: rotationDuties.shiftId }).from(rotationDuties).where(eq(rotationDuties.shiftId, shiftId)).get()
  );
}

/** A Schließeintrag: a rotation entry for a closed day, never with Plätze. */
export function isClosedDuty(shiftId: string): boolean {
  return Boolean(
    db
      .select({ shiftId: rotationDuties.shiftId })
      .from(rotationDuties)
      .where(and(eq(rotationDuties.shiftId, shiftId), eq(rotationDuties.kind, "closed")))
      .get()
  );
}

export function blocksSelfSignup(
  shiftId: string,
  requestingUserId: string,
  targetUserId: string,
  permission: { canManageOthers: boolean }
): boolean {
  return targetUserId === requestingUserId && !permission.canManageOthers && isRotationDuty(shiftId);
}
