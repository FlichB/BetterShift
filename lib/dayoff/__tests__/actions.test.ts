// [fork] Dienstfrei user actions: move, lock, propose, agree (SPEC 12.36–12.37).
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dayOffProposals, dayOffs } from "@/lib/dayoff/schema";
import {
  acceptProposal,
  counterPropose,
  declineProposal,
  listDayOffBoard,
  lockDayOff,
  moveDayOff,
  moveOptions,
  proposeDates,
  reconcileAll,
  reconcileRotation,
} from "@/lib/dayoff/service";
import { auditLogs } from "@/lib/db/schema";
import { rotations } from "@/lib/rotation/schema";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";

async function setup() {
  const s = await seedDuties();
  db.update(rotations).set({ dayOffEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
  db.transaction((tx) => reconcileRotation(tx, s.rotation.id, now));
  const of = (date: string, userId: string) =>
    db.select().from(dayOffs).where(and(eq(dayOffs.shiftId, s.duty(date)), eq(dayOffs.userId, userId))).get();
  return { ...s, of };
}

describe("Dienstfrei actions", () => {
  it("holder moves within the week and back", async () => {
    const s = await setup();
    const id = s.of("2026-11-07", s.m0)!.id;
    expect(moveDayOff(id, "2026-11-12", s.m0, now)).toMatchObject({ status: "moved", date: "2026-11-12" });
    expect(moveDayOff(id, "2026-11-09", s.m0, now)).toMatchObject({ status: "standard", date: "2026-11-09" });
    expect(() => moveDayOff(id, "2026-11-16", s.m0, now)).toThrow(expect.objectContaining({ code: "outsideWeek" }));
  });

  it("move options count colleagues off that day", async () => {
    const s = await setup();
    const opts = moveOptions(s.of("2026-11-07", s.m0)!.id, now);
    expect(opts.map((o) => o.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(opts[0]).toMatchObject({ othersOff: 1, isCurrent: true, isStandard: true });
  });

  it("lock → holder proposes → manager declines with reason → counter → holder accepts", async () => {
    const s = await setup();
    const id = s.of("2026-11-07", s.m0)!.id;
    expect(lockDayOff(id, "Inventur", s.team.ownerId, now)).toMatchObject({ status: "locked", date: null, lockNote: "Inventur" });
    expect(() => moveDayOff(id, "2026-11-10", s.m0, now)).toThrow(expect.objectContaining({ code: "wrongStatus" }));
    const [p1, p2] = proposeDates(id, ["2026-11-18", "2026-11-19"], s.m0, now);
    expect(() => proposeDates(id, ["2026-11-20"], s.m1, now)).toThrow(expect.objectContaining({ code: "notHolder" }));
    expect(() => declineProposal(p1.id, null, s.team.ownerId, true, now)).toThrow(expect.objectContaining({ code: "reasonRequired" }));
    expect(declineProposal(p1.id, "Messe", s.team.ownerId, true, now)).toMatchObject({ status: "declined", declineReason: "Messe" });
    const counter = counterPropose(id, "2026-11-26", s.team.ownerId, now);
    expect(() => acceptProposal(counter.id, s.team.ownerId, true, now)).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(acceptProposal(counter.id, s.m0, false, now)).toMatchObject({ status: "agreed", date: "2026-11-26" });
    expect(db.select().from(dayOffProposals).where(eq(dayOffProposals.id, p2.id)).get()).toMatchObject({ status: "void" });
  });

  it("change request keeps the agreed date until a new one is accepted; relock resets", async () => {
    const s = await setup();
    const id = s.of("2026-11-07", s.m0)!.id;
    lockDayOff(id, null, s.team.ownerId, now);
    acceptProposal(proposeDates(id, ["2026-11-18"], s.m0, now)[0].id, s.team.ownerId, true, now);
    const [change] = proposeDates(id, ["2026-11-20"], s.m0, now);
    expect(db.select().from(dayOffs).where(eq(dayOffs.id, id)).get()).toMatchObject({ status: "agreed", date: "2026-11-18" });
    expect(acceptProposal(change.id, s.team.ownerId, true, now)).toMatchObject({ status: "agreed", date: "2026-11-20" });
    expect(lockDayOff(id, null, s.team.ownerId, now)).toMatchObject({ status: "locked", date: null });
  });

  it("an agreed Dienstfrei that has begun cannot be renegotiated", async () => {
    const s = await setup();
    const id = s.of("2026-11-07", s.m0)!.id;
    lockDayOff(id, null, s.team.ownerId, now);
    acceptProposal(proposeDates(id, ["2026-11-18"], s.m0, now)[0].id, s.team.ownerId, true, now);
    const onTheDay = new Date(2026, 10, 18, 8, 0); // Wed 2026-11-18
    expect(() => proposeDates(id, ["2026-11-25"], s.m0, onTheDay)).toThrow(expect.objectContaining({ code: "alreadyStarted" }));
  });

  it("move options are empty unless the Dienstfrei is standard or moved", async () => {
    const s = await setup();
    const id = s.of("2026-11-07", s.m0)!.id;
    lockDayOff(id, null, s.team.ownerId, now);
    expect(moveOptions(id, now)).toEqual([]);
  });

  it("board lists own and managed Dienstfreie", async () => {
    const s = await setup();
    const board = listDayOffBoard(s.m0, [], now);
    expect(board.mine.map((d) => d.dutyDate)).toEqual(["2026-11-07", "2026-12-12"]);
    expect(listDayOffBoard(s.team.ownerId, [s.team.calendarId], now).manage).toHaveLength(16);
  });

  it("audit-logs Dienstfreie dropped by reconcileAll", async () => {
    const s = await setup();
    const id = s.of("2026-11-07", s.m0)!.id;
    db.update(rotations).set({ dayOffEnabled: false }).where(eq(rotations.id, s.rotation.id)).run();
    reconcileAll(now);
    // logReconcileEvents is fire-and-forget: poll until the row is written (max ~1 s).
    const findLog = () => db.select().from(auditLogs).where(eq(auditLogs.resourceId, id)).get();
    for (let i = 0; i < 100 && !findLog(); i++) await new Promise((r) => setTimeout(r, 10));
    const log = findLog();
    expect(log).toMatchObject({ action: "dayoff.dropped", resourceType: "day_off" });
    expect(JSON.parse(log!.metadata!)).toMatchObject({ dutyDate: "2026-11-07", holderUserId: s.m0, kind: "dropped", reason: "disabled" });
  });
});
