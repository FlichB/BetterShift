import { NextRequest } from "next/server";
import { swapErrorResponse, swapWriteContext } from "@/lib/swap/http";
import { hideOffer, unhideOffer } from "@/lib/swap/service";

// Hiding changes no Platz and no offer, so it is not audit-logged.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await swapWriteContext(request, id);
    if (!ctx.ok) return ctx.response;
    hideOffer(id, ctx.userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return swapErrorResponse(error, "Failed to hide swap offer:");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await swapWriteContext(request, id);
    if (!ctx.ok) return ctx.response;
    unhideOffer(id, ctx.userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return swapErrorResponse(error, "Failed to unhide swap offer:");
  }
}
