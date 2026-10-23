// [fork] Personal ICS feed "nur meine Dienste" (spec 12.20). No session: the secret token is the
// credential; /api/feed/ is already exempt in proxy.ts.
import { NextRequest, NextResponse } from "next/server";
import { isAuthEnabled } from "@/lib/auth/feature-flags";
import { buildPersonalFeed, isUserBanned } from "@/lib/feed/personal";
import { findPersonalFeedToken, touchPersonalFeedToken } from "@/lib/feed/tokens";
import { rateLimit } from "@/lib/rate-limiter";

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!isAuthEnabled()) return notFound();
    const { token: rawToken } = await params;
    // Outlook and some other clients only subscribe to URLs ending in .ics
    const row = findPersonalFeedToken(rawToken.replace(/\.ics$/i, ""));
    if (!row) return notFound();

    const rateLimitResponse = rateLimit(request, row.userId, "calendar-feed");
    if (rateLimitResponse) return rateLimitResponse;

    const now = new Date();
    if (isUserBanned(row.userId, now)) return notFound();
    try {
      touchPersonalFeedToken(row.userId, now);
    } catch (error) {
      console.error("Failed to record personal feed usage:", error);
    }

    return new NextResponse(await buildPersonalFeed(row.userId, now), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="meine-dienste.ics"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Error serving personal feed:", error);
    return NextResponse.json({ error: "Failed to build feed" }, { status: 500 });
  }
}
