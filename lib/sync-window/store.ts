// [fork] Reads and writes the per-feed import horizon (lib/sync-window/schema.ts).
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { externalSyncWindows } from "@/lib/sync-window/schema";
import { DEFAULT_YEARS_AHEAD } from "@/lib/sync-window/window";

export function getYearsAhead(externalSyncId: string): number {
  const row = db.select().from(externalSyncWindows).where(eq(externalSyncWindows.externalSyncId, externalSyncId)).get();
  return row?.yearsAhead ?? DEFAULT_YEARS_AHEAD;
}

export function setYearsAhead(externalSyncId: string, yearsAhead: number): void {
  db.insert(externalSyncWindows)
    .values({ externalSyncId, yearsAhead })
    .onConflictDoUpdate({ target: externalSyncWindows.externalSyncId, set: { yearsAhead } })
    .run();
}

/** The syncs as the API returns them: each with its yearsAhead. */
export function withYearsAhead<T extends { id: string }>(syncs: T[]): (T & { yearsAhead: number })[] {
  if (syncs.length === 0) return [];
  const rows = db
    .select()
    .from(externalSyncWindows)
    .where(inArray(externalSyncWindows.externalSyncId, syncs.map((s) => s.id)))
    .all();
  const byId = new Map(rows.map((r) => [r.externalSyncId, r.yearsAhead]));
  return syncs.map((s) => ({ ...s, yearsAhead: byId.get(s.id) ?? DEFAULT_YEARS_AHEAD }));
}
