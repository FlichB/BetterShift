import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import {
  findPersonalFeedToken,
  getPersonalFeedToken,
  personalFeedUrl,
  revokePersonalFeedToken,
  rotatePersonalFeedToken,
  touchPersonalFeedToken,
} from "@/lib/feed/tokens";
import { createUser } from "@/tests/helpers/seed";

const now = new Date(2026, 9, 23, 12, 0);

describe("personal feed tokens", () => {
  it("creates one token per user and replaces it on rotation", () => {
    const u = createUser("Feed1");
    expect(getPersonalFeedToken(u)).toBeNull();
    const first = rotatePersonalFeedToken(u, now);
    expect(first.rotated).toBe(false);
    expect(first.row.token.length).toBeGreaterThan(30);
    expect(findPersonalFeedToken(first.row.token)?.userId).toBe(u);

    const second = rotatePersonalFeedToken(u, now);
    expect(second.rotated).toBe(true);
    expect(second.row.token).not.toBe(first.row.token);
    expect(findPersonalFeedToken(first.row.token)).toBeNull();
    expect(getPersonalFeedToken(u)?.token).toBe(second.row.token);
  });

  it("revokes and reports whether a link existed", () => {
    const u = createUser("Feed2");
    expect(revokePersonalFeedToken(u)).toBe(false);
    const { row } = rotatePersonalFeedToken(u, now);
    expect(revokePersonalFeedToken(u)).toBe(true);
    expect(findPersonalFeedToken(row.token)).toBeNull();
  });

  it("records the last use", () => {
    const u = createUser("Feed3");
    rotatePersonalFeedToken(u, now);
    const later = new Date(2026, 9, 24, 8, 0);
    touchPersonalFeedToken(u, later);
    expect(getPersonalFeedToken(u)?.lastUsedAt?.getTime()).toBe(later.getTime());
  });

  it("disappears with its user", () => {
    const u = createUser("Feed4");
    const { row } = rotatePersonalFeedToken(u, now);
    db.delete(user).where(eq(user.id, u)).run();
    expect(findPersonalFeedToken(row.token)).toBeNull();
  });

  it("builds an .ics URL Outlook accepts", () => {
    expect(personalFeedUrl("https://plan.example", "abc")).toBe("https://plan.example/api/feed/me/abc.ics");
  });
});
