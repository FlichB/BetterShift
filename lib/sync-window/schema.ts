// [fork] Per-feed import horizon of an external sync. A missing row means DEFAULT_YEARS_AHEAD.
// Migrated through the fork track (drizzle/fork), see docs/adr/0002-eigene-migrationsspur-fuer-fork.md.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { externalSyncs } from "@/lib/db/schema";

export const externalSyncWindows = sqliteTable("external_sync_windows", {
  externalSyncId: text("external_sync_id")
    .primaryKey()
    .references(() => externalSyncs.id, { onDelete: "cascade" }),
  yearsAhead: integer("years_ahead").notNull(),
});
