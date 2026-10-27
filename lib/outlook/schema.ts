// [fork] Outlook sync state, one row per office@ event (spec 12.24/12.32). Fork track (drizzle/fork),
// see docs/adr/0002-eigene-migrationsspur-fuer-fork.md. Core query API only.
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type OutlookEventState = "active" | "cancelled";

/**
 * The office@ event of a Platz (or of a Schließeintrag). Deliberately without foreign keys: when the duty shift or the
 * rotation is deleted, the worker still needs event_id to cancel the event.
 */
export const outlookEvents = sqliteTable(
  "outlook_events",
  {
    // "<shiftId>:<userId>" for a Platz, "<shiftId>" for a Schließeintrag (spec 12.32).
    eventKey: text("event_key").primaryKey(),
    shiftId: text("shift_id").notNull(),
    userId: text("user_id"),
    rotationId: text("rotation_id").notNull(),
    eventId: text("event_id"),
    icalUid: text("ical_uid"),
    // Graph transactionId of a create in flight, reused on retry so a lost response never duplicates an event.
    transactionId: text("transaction_id"),
    fingerprint: text("fingerprint"),
    state: text("state").$type<OutlookEventState>().notNull().default("active"),
    // Start of the duty when last seen; decides "begun" even after the shift is gone.
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
    syncedAt: integer("synced_at", { mode: "timestamp" }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
    lastError: text("last_error"),
  },
  (table) => [
    index("outlook_events_rotationId_idx").on(table.rotationId),
    index("outlook_events_shiftId_idx").on(table.shiftId),
    index("outlook_events_state_next_idx").on(table.state, table.nextAttemptAt),
  ]
);

export type OutlookEvent = typeof outlookEvents.$inferSelect;
