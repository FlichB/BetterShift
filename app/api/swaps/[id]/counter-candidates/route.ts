import { NextRequest, NextResponse } from "next/server";
import { swapErrorResponse, swapManageContext } from "@/lib/swap/http";
import { listCounterCandidates } from "@/lib/swap/service";

// [fork] Candidate counter duties for the Ausgleich; read-only, so not rate limited.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await swapManageContext(request, id, { allowSubstitute: true, rateLimited: false });
    if (!ctx.ok) return ctx.response;
    return NextResponse.json(listCounterCandidates(id, new Date()));
  } catch (error) {
    return swapErrorResponse(error, "Failed to load counter duties:");
  }
}
