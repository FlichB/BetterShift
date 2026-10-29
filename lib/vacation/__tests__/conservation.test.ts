// [fork] Urlaub: a replan keeps everything before changedFrom and every Platz of the round (final review C1).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { vacationOutbox } from "@/lib/vacation/schema";
import { approveVacation, cancelVacation, requestVacation } from "@/lib/vacation/service";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

beforeEach(() => {
  vi.stubEnv("OUTLOOK_ORGANIZER", "office@firma.at");
  vi.stubEnv("OUTLOOK_DRY_RUN", "true");
  db.delete(vacationOutbox).run();
});

// The seed plans Nov–Dec 2026 in two rounds of four Saturdays; every Teilnehmer has two Plätze.
const SATURDAYS = ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28", "2026-12-05", "2026-12-12", "2026-12-19", "2026-12-26"];

describe("replanning around a one-day vacation", () => {
  // Vacation days that are not the first duty of their round, so the round reaches back before changedFrom.
  it.each([
    ["2026-12-12", 0],
    ["2026-12-12", 1],
    ["2026-12-19", 0],
    ["2026-12-19", 1],
    ["2026-11-14", 0],
    ["2026-11-21", 1],
  ])("keeps the past and every Platz (vacation on %s, holder %i)", async (date, index) => {
    const s = await seedDuties();
    const snapshot = () => new Map(SATURDAYS.map((d) => [d, s.holders(s.duty(d))]));
    const counts = (plan: Map<string, string[]>) => {
      const map = new Map(s.team.memberIds.map((u) => [u, 0]));
      for (const holders of plan.values()) for (const u of holders) map.set(u, (map.get(u) as number) + 1);
      return map;
    };
    const before = snapshot();
    const member = before.get(date)![index];

    const v = await requestVacation(member, { startDate: date, endDate: date, note: null }, now);
    await approveVacation(v.id, s.team.ownerId, now);
    const approved = snapshot();
    for (const d of SATURDAYS.filter((d) => d < date)) expect(approved.get(d)).toEqual(before.get(d));
    expect(approved.get(date)).not.toContain(member);
    expect(approved.get(date)).toHaveLength(2);
    // A later duty of the same round takes the swap: nobody gains or loses a Platz.
    expect(counts(approved)).toEqual(counts(before));

    await cancelVacation(v.id, s.team.ownerId, now);
    const cancelled = snapshot();
    for (const d of SATURDAYS.filter((d) => d < date)) expect(cancelled.get(d)).toEqual(before.get(d));
    expect(counts(cancelled)).toEqual(counts(before));
  });
});
