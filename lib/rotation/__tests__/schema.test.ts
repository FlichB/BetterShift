import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
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

describe("closure migration", () => {
  it("defaults the new columns", () => {
    const team = seedTeam({ members: 2 });
    const row = db
      .insert(rotations)
      .values({ calendarId: team.calendarId, name: "R", presetId: team.presetId, perShift: 1, period: "week", startDate: "2026-11-02" })
      .returning()
      .get();
    expect(row).toMatchObject({ closedTitle: "Geschlossen", holidayCalendarId: null, holidayOpenDates: [], skipDates: [] });
  });

  it("turns legacy skip_dates strings into { date, reason }", () => {
    const team = seedTeam({ members: 2 });
    const row = db
      .insert(rotations)
      .values({ calendarId: team.calendarId, name: "Alt", presetId: team.presetId, perShift: 1, period: "week", startDate: "2026-11-02" })
      .returning()
      .get();
    db.run(sql`UPDATE rotations SET skip_dates = '["2026-12-26","2026-12-31"]' WHERE id = ${row.id}`);
    const dir = path.join(process.cwd(), "drizzle", "fork");
    const file = fs.readdirSync(dir).filter((f) => f.startsWith("0004_") && f.endsWith(".sql"))[0];
    const update = fs
      .readFileSync(path.join(dir, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .find((s) => s.startsWith("UPDATE `rotations` SET `skip_dates`"))!;
    db.run(sql.raw(update));
    db.run(sql.raw(update)); // idempotent: already converted rows stay as they are
    const after = db.select().from(rotations).where(eq(rotations.id, row.id)).get()!;
    expect(after.skipDates).toEqual([
      { date: "2026-12-26", reason: "Ausfalltag" },
      { date: "2026-12-31", reason: "Ausfalltag" },
    ]);
  });

  it("clears the holiday calendar reference when that calendar is deleted", () => {
    const team = seedTeam({ members: 2 });
    const holidaysId = crypto.randomUUID();
    db.insert(calendars).values({ id: holidaysId, name: "Feiertage", color: "#ef4444", ownerId: team.ownerId }).run();
    const row = db
      .insert(rotations)
      .values({
        calendarId: team.calendarId,
        name: "FT",
        presetId: team.presetId,
        perShift: 1,
        period: "week",
        startDate: "2026-11-02",
        holidayCalendarId: holidaysId,
      })
      .returning()
      .get();
    db.delete(calendars).where(eq(calendars.id, holidaysId)).run();
    const after = db.select().from(rotations).where(eq(rotations.id, row.id)).get();
    expect(after).toBeDefined();
    expect(after!.holidayCalendarId).toBeNull();
  });
});
