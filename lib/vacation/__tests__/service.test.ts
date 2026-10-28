// [fork] Urlaub workflow (SPEC 12.43 points 2–5, 10).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { vacationChanges, vacationOutbox, vacations } from "@/lib/vacation/schema";
import {
  approveChange,
  approveVacation,
  cancelVacation,
  changeVacation,
  enterVacation,
  listBoard,
  rejectVacation,
  requestChange,
  requestVacation,
  withdrawVacation,
} from "@/lib/vacation/service";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { createRotation, runGeneration, RotationServiceError } from "@/lib/rotation/service";
import { rotations } from "@/lib/rotation/schema";
import { vacationErrorResponse } from "@/lib/vacation/http";

// No request scope in tests: the access resolver reads the token cookie.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

beforeEach(() => {
  vi.stubEnv("OUTLOOK_ORGANIZER", "office@firma.at");
  vi.stubEnv("OUTLOOK_DRY_RUN", "true");
  db.delete(vacationOutbox).run();
});

const kinds = () => db.select({ kind: vacationOutbox.kind }).from(vacationOutbox).all().map((r) => r.kind);

describe("requests", () => {
  it("requests, withdraws and rejects", async () => {
    const s = await seedDuties();
    const v = await requestVacation(s.m1, { startDate: "2026-12-01", endDate: "2026-12-10", note: null }, now);
    expect(v.status).toBe("pending");
    expect(kinds()).toEqual(["vacation_requested"]);
    await expect(withdrawVacation(v.id, s.m2, now)).rejects.toMatchObject({ code: "forbidden" });
    expect((await withdrawVacation(v.id, s.m1, now)).status).toBe("withdrawn");

    const w = await requestVacation(s.m1, { startDate: "2026-12-01", endDate: "2026-12-10", note: null }, now);
    expect((await rejectVacation(w.id, s.team.ownerId, "Inventur", now)).decisionNote).toBe("Inventur");
    expect(kinds()).toContain("vacation_rejected");
  });

  it("refuses non-Teilnehmer, overlaps and begun days", async () => {
    const s = await seedDuties();
    await requestVacation(s.m1, { startDate: "2026-12-01", endDate: "2026-12-10", note: null }, now);
    await expect(requestVacation(s.m1, { startDate: "2026-12-10", endDate: "2026-12-12", note: null }, now)).rejects.toMatchObject({ code: "overlap" });
    await expect(requestVacation(s.m1, { startDate: "2026-10-22", endDate: "2026-10-23", note: null }, now)).rejects.toMatchObject({ code: "begun" });
    await expect(requestVacation(s.team.ownerId, { startDate: "2026-12-01", endDate: "2026-12-02", note: null }, now)).rejects.toMatchObject({ code: "notParticipant" });
  });
});

describe("approve and enter replan", () => {
  it("approving takes the person off their duties", async () => {
    const s = await seedDuties();
    const v = await requestVacation(s.m0, { startDate: "2026-11-05", endDate: "2026-11-09", note: null }, now);
    const approved = await approveVacation(v.id, s.team.ownerId, now);
    expect(approved.status).toBe("approved");
    expect(s.holders(s.duty("2026-11-07"))).not.toContain(s.m0);
    expect(kinds()).toContain("vacation_approved");
  });

  it("entering, changing and cancelling replan from the earlier start", async () => {
    const s = await seedDuties();
    const v = await enterVacation(s.m0, { startDate: "2026-11-05", endDate: "2026-11-09", note: null }, s.team.ownerId, now);
    expect(v.status).toBe("approved");
    await changeVacation(v.id, { startDate: "2026-11-20", endDate: "2026-11-22" }, s.team.ownerId, now);
    const holders1107 = s.holders(s.duty("2026-11-07"));
    expect(s.holders(s.duty("2026-11-21"))).not.toContain(s.m0);
    await cancelVacation(v.id, s.team.ownerId, now);
    expect(db.select().from(vacations).where(eq(vacations.id, v.id)).get()?.status).toBe("cancelled");
    expect(holders1107.length).toBe(2);
    expect(kinds()).toEqual(["vacation_entered", "vacation_changed", "vacation_cancelled"]);
  });
});

describe("change requests", () => {
  it("one open request, approved with replan", async () => {
    const s = await seedDuties();
    const v = await enterVacation(s.m3, { startDate: "2026-11-12", endDate: "2026-11-16", note: null }, s.team.ownerId, now);
    const c = await requestChange(v.id, s.m3, { kind: "cancel", note: "doch nicht" }, now);
    await expect(requestChange(v.id, s.m3, { kind: "cancel", note: null }, now)).rejects.toMatchObject({ code: "changePending" });
    await approveChange(c.id, s.team.ownerId, now);
    expect(db.select().from(vacations).where(eq(vacations.id, v.id)).get()?.status).toBe("cancelled");
    expect(db.select().from(vacationChanges).where(eq(vacationChanges.id, c.id)).get()?.status).toBe("approved");
    expect(kinds()).toContain("vacation_change_requested");
    expect(kinds()).toContain("vacation_cancelled"); // an approved cancel request mails as a cancellation
  });
});

describe("listBoard", () => {
  it("shows own vacations to the person and requests to the Verwaltung", async () => {
    const s = await seedDuties();
    await requestVacation(s.m1, { startDate: "2026-12-01", endDate: "2026-12-03", note: "Familie" }, now);
    const mine = await listBoard(s.m1, 2026, now);
    expect(mine.mine).toHaveLength(1);
    expect(mine.isManager).toBe(false);
    expect(mine.requests).toEqual([]);
    const boss = await listBoard(s.team.ownerId, 2026, now);
    expect(boss.isManager).toBe(true);
    expect(boss.requests.map((r) => r.user.id)).toEqual([s.m1]);
    expect(boss.people.map((p) => p.id)).toContain(s.m1);
  });
});

describe("write-time guards", () => {
  it("lets exactly one of two concurrent approvals through", async () => {
    const s = await seedDuties();
    const v = await requestVacation(s.m0, { startDate: "2026-11-05", endDate: "2026-11-09", note: null }, now);
    const results = await Promise.allSettled([approveVacation(v.id, s.team.ownerId, now), approveVacation(v.id, s.team.ownerId, now)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "wrongStatus" });
    expect(kinds().filter((k) => k === "vacation_approved")).toHaveLength(1);
  });

  it("refuses to approve a withdrawn request", async () => {
    const s = await seedDuties();
    const v = await requestVacation(s.m1, { startDate: "2026-12-01", endDate: "2026-12-03", note: null }, now);
    db.update(vacations).set({ status: "withdrawn" }).where(eq(vacations.id, v.id)).run();
    await expect(approveVacation(v.id, s.team.ownerId, now)).rejects.toMatchObject({ code: "wrongStatus" });
  });
});

describe("rotations that cannot be planned (final review I1)", () => {
  const second = async (s: Awaited<ReturnType<typeof seedDuties>>, generate: boolean) => {
    const r = createRotation(
      {
        name: "Zweite",
        calendarId: s.team.calendarId,
        presetId: s.team.presetId,
        memberIds: [s.m1, s.m2],
        perShift: 1,
        period: "week",
        periodDays: null,
        startDate: "2026-11-02",
        startOffset: 0,
        weekdays: [5],
        skipDates: [],
        closedTitle: "Geschlossen",
        entryTitle: "{Vorname} Dienst",
        dayOffEnabled: false,
        dayOffTitle: "{Vorname} dienstfrei",
        dayOffTiming: "after",
        dayOffExcludedIds: [],
        yearlyFairness: false,
        minPresent: null,
        reinforcedDates: [],
        holidayCalendarId: null,
        holidayOpenDates: [],
      },
      s.team.ownerId
    );
    if (generate) await runGeneration(r.id, "2026-11-02", "2026-12-27", s.team.ownerId, now);
    db.update(rotations).set({ presetId: null }).where(eq(rotations.id, r.id)).run(); // the preset was deleted
    return r;
  };

  it("enters a vacation when another rotation of the person has nothing planned", async () => {
    const s = await seedDuties();
    await second(s, false);
    const v = await enterVacation(s.m1, { startDate: "2026-11-07", endDate: "2026-11-07", note: null }, s.team.ownerId, now);
    expect(v.status).toBe("approved");
    expect(s.holders(s.duty("2026-11-07"))).not.toContain(s.m1);
  });

  it("answers 409 rotationUnavailable when a rotation to replan has no template", async () => {
    const s = await seedDuties();
    await second(s, true);
    const error = await enterVacation(s.m1, { startDate: "2026-11-07", endDate: "2026-11-07", note: null }, s.team.ownerId, now).catch((e) => e);
    expect(error).toBeInstanceOf(RotationServiceError);
    const res = vacationErrorResponse(error, "x");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "rotationUnavailable" });
    expect(db.select().from(vacations).where(eq(vacations.userId, s.m1)).all()).toEqual([]);
  });
});
