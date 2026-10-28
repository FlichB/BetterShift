import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shiftSignups } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/sessions";
import { getShiftSignupPermission } from "@/lib/auth/permissions";
import { canActOnSignup, getShiftOrNull } from "@/lib/shift-signups";
import { blocksSelfSignup } from "@/lib/swap/guard"; // [fork]
import { reconcileForShift } from "@/lib/dayoff/service"; // [fork]

// DELETE withdraw a user from a shift's signup list
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: shiftId, userId: targetUserId } = await params;
    const user = await getSessionUser(request.headers);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const shift = await getShiftOrNull(shiftId);
    if (!shift) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    const permission = await getShiftSignupPermission(
      user.id,
      shift.calendarId
    );
    if (!canActOnSignup(permission, user.id, targetUserId)) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // [fork] Duty Plätze change hands via the swap board only (spec 12.18)
    if (blocksSelfSignup(shiftId, user.id, targetUserId, permission)) {
      return NextResponse.json({ error: "dutySlotSwapOnly" }, { status: 403 });
    }

    await db
      .delete(shiftSignups)
      .where(
        and(
          eq(shiftSignups.shiftId, shiftId),
          eq(shiftSignups.userId, targetUserId)
        )
      );
    // [fork] Dienstfrei follows the Platz; a failure must not fail the committed removal (the hourly job heals it)
    try {
      reconcileForShift(shiftId, new Date());
    } catch (error) {
      console.error("[dayoff] reconcile after signup failed", error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to remove shift signup:", error);
    return NextResponse.json(
      { error: "Failed to remove shift signup" },
      { status: 500 }
    );
  }
}
