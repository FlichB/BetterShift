import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { externalSyncs } from "@/lib/db/schema";
import { getYearsAhead, setYearsAhead, withYearsAhead } from "@/lib/sync-window/store";
import { seedTeam } from "@/tests/helpers/seed";

function seedSync(calendarId: string) {
  const id = crypto.randomUUID();
  db.insert(externalSyncs).values({ id, calendarId, name: "Feiertage", calendarUrl: "https://example.test/f.ics" }).run();
  return id;
}

describe("sync-window store", () => {
  it("uses the default without a row, stores and overwrites a value", () => {
    const { calendarId } = seedTeam({ members: 1 });
    const id = seedSync(calendarId);
    expect(getYearsAhead(id)).toBe(2);
    setYearsAhead(id, 5);
    setYearsAhead(id, 0);
    expect(getYearsAhead(id)).toBe(0);
  });

  it("adds yearsAhead to every sync and drops the row with its sync", () => {
    const { calendarId } = seedTeam({ members: 1 });
    const [a, b] = [seedSync(calendarId), seedSync(calendarId)];
    setYearsAhead(b, 4);
    const rows = withYearsAhead([{ id: a }, { id: b }]);
    expect(rows.map((r) => r.yearsAhead)).toEqual([2, 4]);
    db.delete(externalSyncs).where(eq(externalSyncs.id, b)).run();
    expect(getYearsAhead(b)).toBe(2);
  });
});
