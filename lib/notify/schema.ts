// [fork] Notification outbox and per-user switches (spec 12.27). Fork track (drizzle/fork),
// see docs/adr/0002-eigene-migrationsspur-fuer-fork.md. Core query API only.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "@/lib/db/schema";
import { shiftSwaps } from "@/lib/swap/schema";

export type NotificationKind =
  | "offer_to_all"
  | "offer_to_me"
  | "offer_accepted"
  | "offer_declined"
  | "forced_to_all"
  | "forced_to_me"
  | "duty_transferred"
  | "counter_chosen";
export type NotificationStatus = "pending" | "sent" | "skipped" | "failed";

/** One event per swap action; recipients are resolved when the mail is sent. */
export const notificationOutbox = sqliteTable(
  "notification_outbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    kind: text("kind").$type<NotificationKind>().notNull(),
    swapId: text("swap_id")
      .notNull()
      .references(() => shiftSwaps.id, { onDelete: "cascade" }),
    // Never notified about their own action.
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
  (table) => [index("notification_outbox_status_next_idx").on(table.status, table.nextAttemptAt)]
);

/** A missing row means every switch is on. */
export const notificationPreferences = sqliteTable("notification_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  offersToAll: integer("offers_to_all", { mode: "boolean" }).notNull().default(true),
  offersToMe: integer("offers_to_me", { mode: "boolean" }).notNull().default(true),
  myOffers: integer("my_offers", { mode: "boolean" }).notNull().default(true),
  // [fork] Dienstfrei
  myDayOffs: integer("my_day_offs", { mode: "boolean" }).notNull().default(true),
  dayOffRequests: integer("day_off_requests", { mode: "boolean" }).notNull().default(true),
});
