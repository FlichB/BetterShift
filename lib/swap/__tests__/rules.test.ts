import { describe, expect, it } from "vitest";
import {
  checkAccept,
  checkOffer,
  dueStatus,
  dutySpan,
  nextLock,
  overlaps,
  type AcceptCheckInput,
  type DutyTiming,
  type SlotView,
} from "@/lib/swap/rules";

const now = new Date(2026, 9, 22, 12, 0); // Thu 2026-10-22 12:00

const duty = (shiftId: string, date: string, over: Partial<DutyTiming> = {}): DutyTiming => ({
  shiftId,
  calendarId: "cal",
  date,
  startTime: "09:30",
  endTime: "15:00",
  isAllDay: false,
  ...over,
});
const slot = (d: DutyTiming, holderIds: string[]): SlotView => ({ duty: d, holderIds });

const sat1 = duty("s1", "2026-11-07");
const sat2 = duty("s2", "2026-11-14");

function accept(over: Partial<AcceptCheckInput> = {}): AcceptCheckInput {
  return {
    offer: { type: "give", status: "open", offeredByUserId: "A", targetUserId: null, requestedShiftId: null },
    acceptorId: "C",
    offered: slot(sat1, ["A", "B"]),
    counter: null,
    acceptorDuties: [sat2],
    offererDuties: [sat1],
    now,
    ...over,
  };
}

describe("overlaps", () => {
  it("detects same-time duties and ignores back-to-back ones", () => {
    expect(overlaps(sat1, duty("x", "2026-11-07", { startTime: "14:00", endTime: "18:00" }))).toBe(true);
    expect(overlaps(sat1, duty("x", "2026-11-07", { startTime: "15:00", endTime: "18:00" }))).toBe(false);
  });

  it("lets a duty ending before it starts run into the next day", () => {
    const night = duty("n", "2026-11-06", { startTime: "22:00", endTime: "10:00" });
    expect(overlaps(night, sat1)).toBe(true);
    expect(overlaps(night, duty("x", "2026-11-07", { startTime: "10:00", endTime: "12:00" }))).toBe(false);
  });

  it("treats all-day duties as the whole day", () => {
    expect(overlaps(duty("d", "2026-11-07", { isAllDay: true, startTime: "00:00", endTime: "23:59" }), sat1)).toBe(true);
    expect(overlaps(duty("d", "2026-11-08", { isAllDay: true }), sat1)).toBe(false);
  });
});

describe("dutySpan", () => {
  it("treats an equal start and end as a 24-hour duty", () => {
    const [start, end] = dutySpan(duty("d", "2026-11-07", { startTime: "08:00", endTime: "08:00" }));
    expect(end - start).toBe(1440);
  });
});

describe("checkOffer", () => {
  const base = {
    type: "give" as const,
    offererId: "A",
    targetUserId: null,
    offered: slot(sat1, ["A", "B"]),
    requested: null,
    hasOpenOffer: false,
    now,
  };

  it("accepts an own future Platz", () => {
    expect(checkOffer(base)).toBeNull();
  });

  it("rejects foreign, started and already offered Plätze", () => {
    expect(checkOffer({ ...base, offererId: "C" })).toBe("slotNotOwned");
    expect(checkOffer({ ...base, now: new Date(2026, 10, 7, 9, 30) })).toBe("alreadyStarted");
    expect(checkOffer({ ...base, hasOpenOffer: true })).toBe("duplicateOffer");
    expect(checkOffer({ ...base, targetUserId: "A" })).toBe("invalid");
  });

  it("checks a concrete counter duty", () => {
    const exchange = { ...base, type: "exchange" as const };
    expect(checkOffer({ ...exchange, requested: slot(sat2, ["C", "D"]) })).toBeNull();
    expect(checkOffer({ ...base, requested: slot(sat2, ["C", "D"]) })).toBe("invalid");
    expect(checkOffer({ ...exchange, requested: slot(sat1, ["A", "B"]) })).toBe("invalidShift");
    expect(checkOffer({ ...exchange, requested: slot({ ...sat2, calendarId: "other" }, ["C"]) })).toBe("invalidShift");
    expect(checkOffer({ ...exchange, requested: slot(sat2, ["A", "D"]) })).toBe("alreadyOnDuty");
    expect(checkOffer({ ...base, targetUserId: "B", offered: slot(sat1, ["A", "B"]) })).toBe("alreadyOnDuty");
    expect(checkOffer({ ...exchange, offered: slot(sat1, ["A"]), targetUserId: "B", requested: slot(sat2, ["C", "D"]) })).toBe("slotNotOwned");
    expect(
      checkOffer({ ...exchange, requested: slot(sat2, ["C"]), now: new Date(2026, 10, 14, 10, 0) })
    ).toBe("alreadyStarted");
  });
});

describe("checkAccept", () => {
  it("moves the offered Platz on a give", () => {
    expect(checkAccept(accept())).toEqual({ ok: true, moves: [{ shiftId: "s1", fromUserId: "A", toUserId: "C" }] });
  });

  it("guards status, identity and target", () => {
    expect(checkAccept(accept({ offer: { ...accept().offer, status: "withdrawn" } }))).toEqual({ ok: false, error: "notOpen" });
    expect(checkAccept(accept({ acceptorId: "A" }))).toEqual({ ok: false, error: "ownOffer" });
    expect(checkAccept(accept({ offer: { ...accept().offer, targetUserId: "D" } }))).toEqual({ ok: false, error: "notTarget" });
  });

  it("fails cleanly when the Platz changed hands or the duty started", () => {
    expect(checkAccept(accept({ offered: slot(sat1, ["X", "B"]) }))).toEqual({ ok: false, error: "slotNotOwned" });
    expect(checkAccept(accept({ now: new Date(2026, 10, 7, 9, 30) }))).toEqual({ ok: false, error: "alreadyStarted" });
    expect(checkAccept(accept({ acceptorId: "B" }))).toEqual({ ok: false, error: "alreadyOnDuty" });
  });

  it("refuses an exchange whose counter duty has begun", () => {
    const input = accept({
      offer: { type: "exchange", status: "open", offeredByUserId: "A", targetUserId: null, requestedShiftId: "s1" },
      offered: slot(sat2, ["A", "B"]), // not begun yet
      counter: slot(sat1, ["C", "D"]), // begun
      now: new Date(2026, 10, 7, 10, 0),
    });
    expect(checkAccept(input)).toEqual({ ok: false, error: "alreadyStarted" });
  });

  it("prevents a Doppelbelegung for the acceptor", () => {
    const clash = duty("other-rotation", "2026-11-07", { startTime: "12:00", endTime: "13:00", calendarId: "cal2" });
    expect(checkAccept(accept({ acceptorDuties: [clash] }))).toEqual({ ok: false, error: "doubleBooked" });
  });

  it("swaps both Plätze on an exchange", () => {
    const input = accept({
      offer: { type: "exchange", status: "open", offeredByUserId: "A", targetUserId: null, requestedShiftId: "s2" },
      counter: slot(sat2, ["C", "D"]),
    });
    expect(checkAccept(input)).toEqual({
      ok: true,
      moves: [
        { shiftId: "s1", fromUserId: "A", toUserId: "C" },
        { shiftId: "s2", fromUserId: "C", toUserId: "A" },
      ],
    });
  });

  it("checks the counter duty of an exchange", () => {
    const exchange = { type: "exchange" as const, status: "open" as const, offeredByUserId: "A", targetUserId: null, requestedShiftId: null };
    expect(checkAccept(accept({ offer: exchange, counter: null }))).toEqual({ ok: false, error: "invalid" });
    expect(checkAccept(accept({ offer: exchange, counter: slot(sat2, ["D"]) }))).toEqual({ ok: false, error: "slotNotOwned" });
    expect(checkAccept(accept({ offer: exchange, counter: slot(sat2, ["C", "A"]) }))).toEqual({ ok: false, error: "alreadyOnDuty" });
    expect(checkAccept(accept({ offer: exchange, counter: slot(sat1, ["A", "B"]) }))).toEqual({ ok: false, error: "invalidShift" });
    expect(
      checkAccept(accept({ offer: { ...exchange, requestedShiftId: "s9" }, counter: slot(sat2, ["C"]) }))
    ).toEqual({ ok: false, error: "invalidShift" });
    expect(checkAccept(accept({ counter: slot(sat2, ["C"]) }))).toEqual({ ok: false, error: "invalid" });
  });

  it("prevents a Doppelbelegung for the offerer on an exchange", () => {
    const clash = duty("x", "2026-11-14", { startTime: "08:00", endTime: "10:00" });
    const input = accept({
      offer: { type: "exchange", status: "open", offeredByUserId: "A", targetUserId: null, requestedShiftId: null },
      counter: slot(sat2, ["C"]),
      offererDuties: [sat1, clash],
    });
    expect(checkAccept(input)).toEqual({ ok: false, error: "doubleBooked" });
  });

  it("ignores the Platz handed away in the same exchange", () => {
    // Offerer's own duty sat1 moves away, so the counter duty may overlap it.
    const sameDay = duty("s3", "2026-11-07", { startTime: "10:00", endTime: "11:00" });
    const input = accept({
      offer: { type: "exchange", status: "open", offeredByUserId: "A", targetUserId: null, requestedShiftId: null },
      counter: slot(sameDay, ["C"]),
      acceptorDuties: [sameDay],
    });
    expect(checkAccept(input)).toMatchObject({ ok: true });
  });
});

describe("nextLock", () => {
  it("locks a swapped Platz against the planned Teilnehmer", () => {
    expect(nextLock({ shiftId: "s1", fromUserId: "A", toUserId: "C" }, null)).toEqual({
      shiftId: "s1",
      userId: "C",
      replacesUserId: "A",
    });
  });

  it("keeps the originally planned Teilnehmer over a second swap", () => {
    const existing = { shiftId: "s1", userId: "C", replacesUserId: "A" };
    expect(nextLock({ shiftId: "s1", fromUserId: "C", toUserId: "D" }, existing)).toEqual({
      shiftId: "s1",
      userId: "D",
      replacesUserId: "A",
    });
  });

  it("drops the lock when the Platz returns to the planned Teilnehmer", () => {
    const existing = { shiftId: "s1", userId: "C", replacesUserId: "A" };
    expect(nextLock({ shiftId: "s1", fromUserId: "C", toUserId: "A" }, existing)).toBeNull();
  });
});

describe("dueStatus", () => {
  it("expires offers whose duty has begun", () => {
    expect(dueStatus("A", null, slot(sat1, ["A"]), null, null, new Date(2026, 10, 7, 9, 30))).toBe("expired");
    expect(dueStatus("A", null, slot(sat1, ["A"]), slot(sat2, ["C"]), "s2", new Date(2026, 10, 14, 9, 30))).toBe("expired");
  });

  it("expires a begun duty even when its Platz is already gone", () => {
    expect(dueStatus("A", null, slot(sat1, ["B", "C"]), null, null, new Date(2026, 10, 7, 9, 30))).toBe("expired");
  });

  it("cancels offers whose Platz is gone", () => {
    expect(dueStatus("A", null, slot(sat1, ["B", "C"]), null, null, now)).toBe("cancelled");
    expect(dueStatus("A", null, null, null, null, now)).toBe("cancelled");
    expect(dueStatus("A", null, slot(sat1, ["A"]), null, "s2", now)).toBe("cancelled");
  });

  it("leaves valid offers open", () => {
    expect(dueStatus("A", null, slot(sat1, ["A", "B"]), slot(sat2, ["C"]), "s2", now)).toBeNull();
  });

  it("cancels a Direktanfrage whose requested duty is no longer the target's", () => {
    expect(dueStatus("A", "B", slot(sat1, ["A"]), slot(sat2, ["C"]), "s2", now)).toBe("cancelled");
  });

  it("cancels an exchange whose requested duty the offerer now holds", () => {
    expect(dueStatus("A", null, slot(sat1, ["A"]), slot(sat2, ["A", "C"]), "s2", now)).toBe("cancelled");
  });

  it("keeps a broadcast exchange open while someone holds the requested duty", () => {
    expect(dueStatus("A", null, slot(sat1, ["A"]), slot(sat2, ["C"]), "s2", now)).toBeNull();
  });
});
