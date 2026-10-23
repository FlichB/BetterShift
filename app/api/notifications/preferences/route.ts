// [fork] Own swap-notification switches (spec 12.27).
import { NextRequest, NextResponse } from "next/server";
import { isAuthEnabled } from "@/lib/auth/feature-flags";
import { getSessionUser } from "@/lib/auth/sessions";
import { rateLimit } from "@/lib/rate-limiter";
import { getPreferences, setPreferences, validatePreferences } from "@/lib/notify/preferences";
import type { NotificationSettings } from "@/lib/notify/types";
import { isOutlookConfigured } from "@/lib/outlook/config";
import { readJson } from "@/lib/rotation/http";

const notFound = () => NextResponse.json({ error: "notFound" }, { status: 404 });
const unauthorized = () => NextResponse.json({ error: "forbidden" }, { status: 401 });

export async function GET(request: NextRequest) {
  if (!isAuthEnabled()) return notFound();
  const user = await getSessionUser(request.headers);
  if (!user) return unauthorized();
  const body: NotificationSettings = { configured: isOutlookConfigured(), preferences: getPreferences(user.id) };
  return NextResponse.json(body);
}

export async function PUT(request: NextRequest) {
  if (!isAuthEnabled()) return notFound();
  const user = await getSessionUser(request.headers);
  if (!user) return unauthorized();
  const rateLimitResponse = rateLimit(request, user.id, "swap-mutations");
  if (rateLimitResponse) return rateLimitResponse;
  const preferences = validatePreferences(await readJson(request));
  if (!preferences) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const body: NotificationSettings = { configured: isOutlookConfigured(), preferences: setPreferences(user.id, preferences) };
  return NextResponse.json(body);
}
