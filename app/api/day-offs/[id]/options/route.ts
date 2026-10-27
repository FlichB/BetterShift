// [fork] Dienstfrei API route.
import { NextRequest, NextResponse } from "next/server";
import { counterWindowEnd } from "@/lib/swap/rules";
import { dayOffContext, dayOffErrorResponse } from "@/lib/dayoff/http";
import { moveOptions } from "@/lib/dayoff/service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await dayOffContext(request, id, { rateLimited: false });
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({ options: moveOptions(id, new Date()), windowEnd: counterWindowEnd(ctx.row.dutyDate) });
  } catch (error) {
    return dayOffErrorResponse(error, "Failed to load Dienstfrei options:");
  }
}
