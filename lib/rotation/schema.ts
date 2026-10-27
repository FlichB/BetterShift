// [fork] Rotation tables. Kept out of lib/db/schema.ts and migrated through
// their own track (drizzle/fork), see docs/adr/0002-eigene-migrationsspur-fuer-fork.md.
// Uses only the core query API — these tables are not part of db.query.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { calendars, shiftPresets, shifts, user } from "@/lib/db/schema";
import type { ReinforcedDate, RotationDutyKind, RotationPeriod, SkipDate } from "@/lib/rotation/types";

export const rotations = sqliteTable(
  "rotations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // null once the preset is deleted; generating then fails until a new one is picked
    presetId: text("preset_id").references(() => shiftPresets.id, { onDelete: "set null" }),
    perShift: integer("per_shift").notNull(),
    period: text("period").$type<RotationPeriod>().notNull(),
    periodDays: integer("period_days"),
    startDate: text("start_date").notNull(),
    startOffset: integer("start_offset").notNull().default(0),
    weekdays: text("weekdays", { mode: "json" }).$type<number[]>().notNull().default(sql`'[]'`),
    skipDates: text("skip_dates", { mode: "json" }).$type<SkipDate[]>().notNull().default(sql`'[]'`),
    // [fork] Schließtage (spec 2026-10-27): Feiertagskalender, Text bei Schließung, geöffnete Feiertage.
    holidayCalendarId: text("holiday_calendar_id").references(() => calendars.id, { onDelete: "set null" }),
    closedTitle: text("closed_title").notNull().default("Geschlossen"),
    holidayOpenDates: text("holiday_open_dates", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    // [fork] Verstärkte Tage (spec 2026-10-27): more Plätze on single dates.
    reinforcedDates: text("reinforced_dates", { mode: "json" }).$type<ReinforcedDate[]>().notNull().default(sql`'[]'`),
    // [fork] Eintragsvorlage (spec 2026-10-27 "Ein Eintrag pro Person").
    entryTitle: text("entry_title").notNull().default("{Vorname} Dienst"),
    // [fork phase 3] Mirror this rotation's duties into the office@ calendar (spec 12.24).
    outlookEnabled: integer("outlook_enabled", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("rotations_calendarId_idx").on(table.calendarId)]
);

export const rotationMembers = sqliteTable(
  "rotation_members",
  {
    rotationId: text("rotation_id")
      .notNull()
      .references(() => rotations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => [primaryKey({ columns: [table.rotationId, table.userId] })]
);

/** Links a generated shift to its rotation; (rotation, date) is the idempotency key. */
export const rotationDuties = sqliteTable(
  "rotation_duties",
  {
    shiftId: text("shift_id")
      .primaryKey()
      .references(() => shifts.id, { onDelete: "cascade" }),
    rotationId: text("rotation_id")
      .notNull()
      .references(() => rotations.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    kind: text("kind").$type<RotationDutyKind>().notNull().default("duty"),
  },
  (table) => [uniqueIndex("rotation_duties_rotationId_date_idx").on(table.rotationId, table.date)]
);

/** A Gesperrter Platz: written by a swap (phase 2), never overwritten by generation. */
export const rotationSlotLocks = sqliteTable(
  "rotation_slot_locks",
  {
    shiftId: text("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    replacesUserId: text("replaces_user_id").references(() => user.id, { onDelete: "set null" }),
    lockedAt: integer("locked_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.shiftId, table.userId] })]
);

export type Rotation = typeof rotations.$inferSelect;
export type NewRotation = typeof rotations.$inferInsert;
