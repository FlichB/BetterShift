// [fork] Dienstfrei tables (design 2). Migrated through the fork track (drizzle/fork).
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { shifts, user } from "@/lib/db/schema";
import { rotations } from "@/lib/rotation/schema";
import type { NotificationStatus } from "@/lib/notify/schema";
import type {
  DayOffAudience,
  DayOffNotificationKind,
  DayOffStatus,
  DropReason,
  ProposalSide,
  ProposalStatus,
} from "@/lib/dayoff/types";

/** A Dienstfrei: the free weekday after one Platz (duty shift + user). */
export const dayOffs = sqliteTable(
  "day_offs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    rotationId: text("rotation_id")
      .notNull()
      .references(() => rotations.id, { onDelete: "cascade" }),
    // set null when the duty is deleted, the row then survives as history
    shiftId: text("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    dutyDate: text("duty_date").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").$type<DayOffStatus>().notNull(),
    standardDate: text("standard_date"),
    date: text("date"),
    lockedByUserId: text("locked_by_user_id").references(() => user.id, { onDelete: "set null" }),
    agreedByUserId: text("agreed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    lockNote: text("lock_note"),
    dropReason: text("drop_reason").$type<DropReason>(),
    // The holder gave the Platz away by swap and keeps this Dienstfrei (timing "before", SPEC 12.42).
    keptOnSwap: integer("kept_on_swap", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("day_offs_seat_idx")
      .on(table.shiftId, table.userId)
      .where(sql`shift_id is not null and status != 'dropped'`),
    index("day_offs_user_date_idx").on(table.userId, table.date),
    index("day_offs_rotation_idx").on(table.rotationId),
  ]
);

/** A date proposal on a Dienstfrei, from the holder or from a manager. */
export const dayOffProposals = sqliteTable(
  "day_off_proposals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    dayOffId: text("day_off_id")
      .notNull()
      .references(() => dayOffs.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    side: text("side").$type<ProposalSide>().notNull(),
    proposedByUserId: text("proposed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    status: text("status").$type<ProposalStatus>().notNull().default("open"),
    declineReason: text("decline_reason"),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, { onDelete: "set null" }),
    remindedAt: integer("reminded_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  },
  (table) => [index("day_off_proposals_day_off_idx").on(table.dayOffId, table.status)]
);

/** Notification outbox for Dienstfrei events. */
export const dayOffOutbox = sqliteTable(
  "day_off_outbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    kind: text("kind").$type<DayOffNotificationKind>().notNull(),
    dayOffId: text("day_off_id")
      .notNull()
      .references(() => dayOffs.id, { onDelete: "cascade" }),
    proposalId: text("proposal_id").references(() => dayOffProposals.id, { onDelete: "set null" }),
    audience: text("audience").$type<DayOffAudience>().notNull(),
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
  (table) => [index("day_off_outbox_due_idx").on(table.status, table.nextAttemptAt)]
);

export type DayOff = typeof dayOffs.$inferSelect;
export type DayOffProposal = typeof dayOffProposals.$inferSelect;
