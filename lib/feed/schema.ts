// [fork] Personal ICS feed "nur meine Dienste" (spec 12.20): one secret link per user.
// Migrated through the fork track (drizzle/fork), see docs/adr/0002-eigene-migrationsspur-fuer-fork.md.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "@/lib/db/schema";

export const personalFeedTokens = sqliteTable("personal_feed_tokens", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  // Set explicitly on insert: SQLite's CURRENT_TIMESTAMP yields text, not epoch seconds.
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
});

export type PersonalFeedToken = typeof personalFeedTokens.$inferSelect;
