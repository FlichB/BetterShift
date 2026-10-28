import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars, shifts } from "@/lib/db/schema";
import { parseLocalDate } from "@/lib/date-utils";
import { rotationDuties, rotationMembers, rotationYearDeltas, rotations } from "@/lib/rotation/schema";
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

describe("entry template migration", () => {
  it("stores the Eintragsvorlage with the standard default", () => {
    const team = seedTeam({ members: 2 });
    const row = db
      .insert(rotations)
      .values({ calendarId: team.calendarId, name: "R", presetId: team.presetId, perShift: 1, period: "week", startDate: "2026-11-02" })
      .returning()
      .get();
    expect(row.entryTitle).toBe("{Vorname} Dienst");
  });

  it("defaults yearly fairness off and stores Delta overrides per rotation, year and user", () => {
    const team = seedTeam({ members: 2 });
    const [row] = db
      .insert(rotations)
      .values({ calendarId: team.calendarId, name: "R", presetId: team.presetId, perShift: 1, period: "week", startDate: "2026-11-02" })
      .returning()
      .all();
    expect(row.yearlyFairness).toBe(false);
    db.insert(rotationYearDeltas).values({ rotationId: row.id, year: 2027, userId: team.memberIds[0], delta: 2 }).run();
    expect(() =>
      db.insert(rotationYearDeltas).values({ rotationId: row.id, year: 2027, userId: team.memberIds[0], delta: 1 }).run()
    ).toThrow();
    db.delete(rotations).where(eq(rotations.id, row.id)).run();
    expect(db.select().from(rotationYearDeltas).all()).toHaveLength(0);
  });
});

describe("joinedOn restart migration (0012)", () => {
  function migration0012(): string[] {
    const dir = path.join(process.cwd(), "drizzle", "fork");
    const file = fs.readdirSync(dir).filter((f) => f.startsWith("0012_") && f.endsWith(".sql"))[0];
    return fs
      .readFileSync(path.join(dir, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.replace(/^--.*$/gm, "").trim())
      .filter((s) => s.length > 0);
  }

  function rotationWith(team: ReturnType<typeof seedTeam>, startDate: string, duties: { date: string; kind: "duty" | "closed" }[]) {
    const row = db
      .insert(rotations)
      .values({ calendarId: team.calendarId, name: "R", presetId: team.presetId, perShift: 1, period: "week", startDate })
      .returning()
      .get();
    for (const { date, kind } of duties) {
      const shift = db
        .insert(shifts)
        .values({ calendarId: team.calendarId, date: parseLocalDate(date), startTime: "09:00", endTime: "17:00", title: "Dienst" })
        .returning()
        .get();
      db.insert(rotationDuties).values({ shiftId: shift.id, rotationId: row.id, date, kind }).run();
    }
    return row.id;
  }

  const joinedOn = (rotationId: string) =>
    Object.fromEntries(
      db
        .select({ userId: rotationMembers.userId, joinedOn: rotationMembers.joinedOn })
        .from(rotationMembers)
        .where(eq(rotationMembers.rotationId, rotationId))
        .all()
        .map((m) => [m.userId, m.joinedOn])
    );

  it("moves joinedOn of a rotation restarted before the migration back to its first held duty", () => {
    const team = seedTeam({ members: 3 });
    const [m1, m2, m3] = team.memberIds;
    // Restarted on 2027-03-01 after duties since November; the closure before them does not count.
    const restarted = rotationWith(team, "2027-03-01", [
      { date: "2026-10-31", kind: "closed" },
      { date: "2026-11-07", kind: "duty" },
      { date: "2027-03-06", kind: "duty" },
    ]);
    db.insert(rotationMembers)
      .values([
        { rotationId: restarted, userId: m1, position: 0, joinedOn: "2027-03-01" },
        { rotationId: restarted, userId: m2, position: 1, joinedOn: "2027-03-01" },
        { rotationId: restarted, userId: m3, position: 2, joinedOn: "2027-03-02" }, // joined later on its own
      ])
      .run();
    // Never restarted: no duty before startDate, nothing changes.
    const fresh = rotationWith(team, "2026-11-02", [{ date: "2026-11-07", kind: "duty" }]);
    db.insert(rotationMembers).values({ rotationId: fresh, userId: m1, position: 0, joinedOn: "2026-11-02" }).run();

    const statements = migration0012();
    expect(statements.length).toBeGreaterThan(0);
    for (let run = 0; run < 2; run++) for (const s of statements) db.run(sql.raw(s)); // idempotent

    expect(joinedOn(restarted)).toEqual({ [m1]: "2026-11-07", [m2]: "2026-11-07", [m3]: "2027-03-02" });
    expect(joinedOn(fresh)).toEqual({ [m1]: "2026-11-02" });
  });
});
