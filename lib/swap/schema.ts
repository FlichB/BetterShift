// [fork] Swap board tables. Kept out of lib/db/schema.ts and migrated through
// the fork track (drizzle/fork), see docs/adr/0002-eigene-migrationsspur-fuer-fork.md.
// Uses only the core query API — these tables are not part of db.query.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { shifts, user } from "@/lib/db/schema";
import type { CounterStatus, SwapStatus, SwapType } from "@/lib/swap/types";

/** An Angebot: one Platz (offered shift + offering user) swapped, or handed over by force. */
export const shiftSwaps = sqliteTable(
  "shift_swaps",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    type: text("type").$type<SwapType>().notNull(),
    status: text("status").$type<SwapStatus>().notNull().default("open"),
    offeredShiftId: text("offered_shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    offeredByUserId: text("offered_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // null = an alle, otherwise a Direktanfrage
    targetUserId: text("target_user_id").references(() => user.id, { onDelete: "cascade" }),
    // exchange only: null = beliebig. Cascade, so a deleted counter duty never turns into "beliebig".
    requestedShiftId: text("requested_shift_id").references(() => shifts.id, { onDelete: "cascade" }),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "set null" }),
    acceptedShiftId: text("accepted_shift_id").references(() => shifts.id, { onDelete: "set null" }),
    note: text("note"),
    // forced only (spec D3-D8)
    forcedByUserId: text("forced_by_user_id").references(() => user.id, { onDelete: "set null" }),
    counterStatus: text("counter_status").$type<CounterStatus>(),
    // last day of the Ausgleichsfenster, local YYYY-MM-DD
    counterWindowEnd: text("counter_window_end"),
    counterResolvedByUserId: text("counter_resolved_by_user_id").references(() => user.id, { onDelete: "set null" }),
    waiveReason: text("waive_reason"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("shift_swaps_open_slot_idx")
      .on(table.offeredShiftId, table.offeredByUserId)
      .where(sql`status = 'open'`),
    index("shift_swaps_status_idx").on(table.status),
    index("shift_swaps_targetUserId_idx").on(table.targetUserId),
    index("shift_swaps_counter_pending_idx")
      .on(table.acceptedByUserId)
      .where(sql`counter_status = 'pending'`),
  ]
);

/** Offers an alle that a user chose to hide from their board. */
export const shiftSwapHidden = sqliteTable(
  "shift_swap_hidden",
  {
    swapId: text("swap_id")
      .notNull()
      .references(() => shiftSwaps.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.swapId, table.userId] })]
);

export type ShiftSwap = typeof shiftSwaps.$inferSelect;
