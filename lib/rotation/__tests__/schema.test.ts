import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rotationMembers, rotations } from "@/lib/rotation/schema";
import { seedTeam } from "@/tests/helpers/seed";

describe("rotation schema", () => {
  it("stores a rotation with ordered members and json columns", () => {
    const team = seedTeam({ members: 2 });
    const [row] = db
      .insert(rotations)
      .values({
        calendarId: team.calendarId,
        name: "Samstagsdienst",
        presetId: team.presetId,
        perShift: 2,
        period: "week",
        startDate: "2026-11-02",
        weekdays: [6],
      })
      .returning()
      .all();
    db.insert(rotationMembers)
      .values(team.memberIds.map((userId, position) => ({ rotationId: row.id, userId, position })))
      .run();

    expect(row.weekdays).toEqual([6]);
    expect(row.skipDates).toEqual([]);
    expect(db.select().from(rotationMembers).where(eq(rotationMembers.rotationId, row.id)).all()).toHaveLength(2);
  });
});
