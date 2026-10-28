// [fork] Urlaub tables (SPEC 12.43, design §2). Migrated through the fork track (drizzle/fork).
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "@/lib/db/schema";
import type { NotificationStatus } from "@/lib/notify/schema";
import type { ChangeKind, ChangeStatus, VacationNotificationKind, VacationStatus } from "@/lib/vacation/types";

/** A vacation of one person: requested, or approved / entered by the Verwaltung. */
export const vacations = sqliteTable(
  "vacations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    note: text("note"),
    status: text("status").$type<VacationStatus>().notNull(),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    decisionNote: text("decision_note"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("vacations_user_start_idx").on(table.userId, table.startDate), index("vacations_status_idx").on(table.status)]
);

/** A change or cancel request of the person for an approved vacation. */
export const vacationChanges = sqliteTable(
  "vacation_changes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    vacationId: text("vacation_id")
      .notNull()
      .references(() => vacations.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ChangeKind>().notNull(),
    startDate: text("start_date"),
    endDate: text("end_date"),
    note: text("note"),
    status: text("status").$type<ChangeStatus>().notNull(),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    decisionNote: text("decision_note"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("vacation_changes_open_idx").on(table.vacationId).where(sql`status = 'pending'`)]
);

/** Notification outbox for Urlaub events; recipients are resolved at send time. */
export const vacationOutbox = sqliteTable(
  "vacation_outbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    kind: text("kind").$type<VacationNotificationKind>().notNull(),
    vacationId: text("vacation_id")
      .notNull()
      .references(() => vacations.id, { onDelete: "cascade" }),
    changeId: text("change_id").references(() => vacationChanges.id, { onDelete: "set null" }),
    // The range before a change or cancel, for the mail text.
    previousStart: text("previous_start"),
    previousEnd: text("previous_end"),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    status: text("status").$type<NotificationStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    sentAt: integer("sent_at", { mode: "timestamp" }),
  },
  (table) => [index("vacation_outbox_due_idx").on(table.status, table.nextAttemptAt)]
);

export type Vacation = typeof vacations.$inferSelect;
export type VacationChange = typeof vacationChanges.$inferSelect;
export type VacationOutboxRow = typeof vacationOutbox.$inferSelect;
