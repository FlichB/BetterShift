import { describe, expect, it } from "vitest";
import { canManageRotations } from "@/lib/rotation/permissions";
import { createUser, seedTeam, shareCalendar } from "@/tests/helpers/seed";

describe("canManageRotations", () => {
  it("allows the owner, admin bundle holders and site admins", async () => {
    const team = seedTeam({ members: 2 });
    const calendarAdmin = createUser("KalAdmin");
    shareCalendar(team.calendarId, calendarAdmin, "admin", team.ownerId);
    const siteAdmin = createUser("SiteAdmin", "admin");

    expect(await canManageRotations(team.ownerId, team.calendarId)).toBe(true);
    expect(await canManageRotations(calendarAdmin, team.calendarId)).toBe(true);
    expect(await canManageRotations(siteAdmin, team.calendarId)).toBe(true);
  });

  it("denies Teilnehmer with Read, outsiders and guests", async () => {
    const team = seedTeam({ members: 2 });
    const outsider = createUser("Fremd");
    expect(await canManageRotations(team.memberIds[0], team.calendarId)).toBe(false);
    expect(await canManageRotations(outsider, team.calendarId)).toBe(false);
    expect(await canManageRotations(null, team.calendarId)).toBe(false);
  });
});
