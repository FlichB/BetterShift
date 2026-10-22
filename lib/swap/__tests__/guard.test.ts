import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { shifts } from "@/lib/db/schema";
import { parseLocalDate } from "@/lib/date-utils";
import { blocksSelfSignup, isRotationDuty } from "@/lib/swap/guard";
import { seedDuties } from "./fixtures";

let s: Awaited<ReturnType<typeof seedDuties>>;
beforeEach(async () => {
  s = await seedDuties();
});

describe("self-signup guard", () => {
  it("knows duties from plain shifts", () => {
    const plain = db
      .insert(shifts)
      .values({ calendarId: s.team.calendarId, date: parseLocalDate("2026-11-08"), startTime: "10:00", endTime: "12:00", title: "Frei" })
      .returning()
      .get();
    expect(isRotationDuty(s.duty("2026-11-07"))).toBe(true);
    expect(isRotationDuty(plain.id)).toBe(false);
    expect(blocksSelfSignup(plain.id, s.m0, s.m0, { canManageOthers: false })).toBe(false);
  });

  it("blocks self sign-up and withdrawal on duties for plain Teilnehmer", () => {
    expect(blocksSelfSignup(s.duty("2026-11-07"), s.m0, s.m0, { canManageOthers: false })).toBe(true);
  });

  it("lets people who may sign up others reassign by hand", () => {
    expect(blocksSelfSignup(s.duty("2026-11-07"), s.team.ownerId, s.team.ownerId, { canManageOthers: true })).toBe(false);
    expect(blocksSelfSignup(s.duty("2026-11-07"), s.team.ownerId, s.m0, { canManageOthers: true })).toBe(false);
  });
});
