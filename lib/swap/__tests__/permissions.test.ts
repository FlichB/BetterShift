import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { canOtherUserSwap } from "@/lib/swap/permissions";
import { createUser, seedTeam } from "@/tests/helpers/seed";

describe("canOtherUserSwap", () => {
  it("allows members with signUpSelf and the owner", async () => {
    const team = seedTeam({ members: 1 });
    expect(await canOtherUserSwap(team.memberIds[0], team.calendarId)).toBe(true);
    expect(await canOtherUserSwap(team.ownerId, team.calendarId)).toBe(true);
  });

  it("denies users without any access", async () => {
    const team = seedTeam({ members: 1 });
    expect(await canOtherUserSwap(createUser("Fremd"), team.calendarId)).toBe(false);
  });

  it("denies everyone when signups are switched off", async () => {
    const team = seedTeam({ members: 1 });
    db.update(calendars).set({ signupsEnabled: false }).where(eq(calendars.id, team.calendarId)).run();
    expect(await canOtherUserSwap(team.memberIds[0], team.calendarId)).toBe(false);
    expect(await canOtherUserSwap(team.ownerId, team.calendarId)).toBe(false);
  });
});
