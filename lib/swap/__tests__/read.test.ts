import { beforeEach, describe, expect, it } from "vitest";
import { acceptOffer, calendarState, createOffer, hideOffer, listBoard, listDuties } from "@/lib/swap/service";
import { now, seedDuties } from "./fixtures";

let s: Awaited<ReturnType<typeof seedDuties>>;
beforeEach(async () => {
  s = await seedDuties();
});

const give = (shiftId: string, by: string, targetUserId: string | null = null) =>
  createOffer({ shiftId, type: "give", targetUserId, requestedShiftId: null, note: "Urlaub" }, by, now);

describe("listBoard", () => {
  it("shows broadcast and direct offers to the right people", () => {
    const broadcast = give(s.duty("2026-11-07"), s.m0);
    const direct = give(s.duty("2026-11-14"), s.m2, s.m4);
    const cal = [s.team.calendarId];

    expect(listBoard(s.m4, cal, now, false).forMe.map((e) => e.id).sort()).toEqual([broadcast.id, direct.id].sort());
    expect(listBoard(s.m1, cal, now, false).forMe.map((e) => e.id)).toEqual([broadcast.id]);
    expect(listBoard(s.m0, cal, now, false).forMe).toHaveLength(0);
    expect(listBoard(s.m0, cal, now, false).mine.map((e) => e.id)).toEqual([broadcast.id]);
  });

  it("fills the entry with duty, people and note", () => {
    give(s.duty("2026-11-07"), s.m0);
    const [entry] = listBoard(s.m4, [s.team.calendarId], now, false).forMe;
    expect(entry).toMatchObject({
      type: "give",
      status: "open",
      calendarName: "Team",
      offered: { date: "2026-11-07", startTime: "09:30", endTime: "15:00", title: "Samstagsdienst" },
      offeredBy: { id: s.m0, name: "M1" },
      target: null,
      note: "Urlaub",
    });
  });

  it("moves hidden offers out of forMe for that user only", () => {
    const broadcast = give(s.duty("2026-11-07"), s.m0);
    hideOffer(broadcast.id, s.m4);
    expect(listBoard(s.m4, [s.team.calendarId], now, false).forMe).toHaveLength(0);
    expect(listBoard(s.m4, [s.team.calendarId], now, true).hidden.map((e) => e.id)).toEqual([broadcast.id]);
    expect(listBoard(s.m5, [s.team.calendarId], now, false).forMe).toHaveLength(1);
  });

  it("shows nothing for calendars the user cannot swap in", () => {
    give(s.duty("2026-11-07"), s.m0);
    expect(listBoard(s.m4, [], now, false).forMe).toHaveLength(0);
  });

  it("keeps resolved own offers in mine with the acceptor", () => {
    const swap = give(s.duty("2026-11-07"), s.m0);
    acceptOffer(swap.id, s.m2, null, now);
    const [entry] = listBoard(s.m0, [s.team.calendarId], now, false).mine;
    expect(entry).toMatchObject({ status: "accepted", acceptedBy: { id: s.m2 } });
  });
});

describe("listDuties", () => {
  it("lists upcoming duties with holders and my open offer", () => {
    const swap = give(s.duty("2026-11-07"), s.m0);
    const duties = listDuties(s.team.calendarId, s.m0, now);
    expect(duties.map((d) => d.date)).toEqual([
      "2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28",
      "2026-12-05", "2026-12-12", "2026-12-19", "2026-12-26",
    ]);
    expect(duties[0]).toMatchObject({ myOpenSwapId: swap.id });
    expect(duties[0].holders.map((h) => h.id).sort()).toEqual([s.m0, s.m1].sort());
    expect(listDuties(s.team.calendarId, s.m0, new Date(2026, 10, 7, 10, 0))[0].date).toBe("2026-11-14");
  });
});

describe("calendarState", () => {
  it("lists duties and duties with open offers", () => {
    give(s.duty("2026-11-07"), s.m0);
    const state = calendarState(s.team.calendarId, now);
    expect(state.dutyShiftIds).toHaveLength(8);
    expect(state.openOfferShiftIds).toEqual([s.duty("2026-11-07")]);
  });
});
