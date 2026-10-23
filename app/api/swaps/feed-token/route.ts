// [fork] The signed-in user's personal feed link: show, create/replace, revoke (spec 12.20).
import { NextRequest, NextResponse } from "next/server";
import { logUserAction } from "@/lib/audit-log";
import { isAuthEnabled } from "@/lib/auth/feature-flags";
import { getSessionUser } from "@/lib/auth/sessions";
import type { PersonalFeedTokenMetadata } from "@/lib/feed/audit";
import type { PersonalFeedToken } from "@/lib/feed/schema";
import { getPersonalFeedToken, personalFeedUrl, revokePersonalFeedToken, rotatePersonalFeedToken } from "@/lib/feed/tokens";
import type { PersonalFeedInfo } from "@/lib/feed/types";
import { getAppUrl } from "@/lib/outlook/config";
import { rateLimit } from "@/lib/rate-limiter";

const notFound = () => NextResponse.json({ error: "notFound" }, { status: 404 });
const unauthorized = () => NextResponse.json({ error: "forbidden" }, { status: 401 });

function toInfo(row: PersonalFeedToken | null): PersonalFeedInfo {
  return {
    token: row?.token ?? null,
    url: row ? personalFeedUrl(getAppUrl(), row.token) : null,
    createdAt: row?.createdAt.toISOString() ?? null,
    lastUsedAt: row?.lastUsedAt?.toISOString() ?? null,
  };
}

async function sessionUserId(request: NextRequest): Promise<string | NextResponse> {
  if (!isAuthEnabled()) return notFound();
  const user = await getSessionUser(request.headers);
  return user ? user.id : unauthorized();
}

export async function GET(request: NextRequest) {
  try {
    const userId = await sessionUserId(request);
    if (userId instanceof NextResponse) return userId;
    return NextResponse.json(toInfo(getPersonalFeedToken(userId)));
  } catch (error) {
    console.error("[API] GET /api/swaps/feed-token error:", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await sessionUserId(request);
    if (userId instanceof NextResponse) return userId;
    const rateLimitResponse = rateLimit(request, userId, "token-creation", userId);
    if (rateLimitResponse) return rateLimitResponse;

    const { row, rotated } = rotatePersonalFeedToken(userId, new Date());
    void logUserAction<PersonalFeedTokenMetadata>({
      action: rotated ? "personal_feed.rotated" : "personal_feed.created",
      userId,
      resourceType: "user",
      resourceId: userId,
      metadata: { rotated },
      request,
    });
    return NextResponse.json(toInfo(row), { status: 201 });
  } catch (error) {
    console.error("[API] POST /api/swaps/feed-token error:", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await sessionUserId(request);
    if (userId instanceof NextResponse) return userId;
    if (revokePersonalFeedToken(userId)) {
      void logUserAction<PersonalFeedTokenMetadata>({
        action: "personal_feed.revoked",
        userId,
        resourceType: "user",
        resourceId: userId,
        metadata: { rotated: false },
        request,
      });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[API] DELETE /api/swaps/feed-token error:", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
