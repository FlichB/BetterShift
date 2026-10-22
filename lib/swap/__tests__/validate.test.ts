import { describe, expect, it } from "vitest";
import { validateAccept, validateOffer } from "@/lib/swap/validate";

describe("validateOffer", () => {
  it("normalises a minimal give", () => {
    expect(validateOffer({ shiftId: "s1", type: "give" })).toEqual({
      ok: true,
      value: { shiftId: "s1", type: "give", targetUserId: null, requestedShiftId: null, note: null },
    });
  });

  it("trims the note and drops empty ones", () => {
    expect(validateOffer({ shiftId: "s1", type: "give", note: "  Urlaub " })).toMatchObject({ value: { note: "Urlaub" } });
    expect(validateOffer({ shiftId: "s1", type: "give", note: "  " })).toMatchObject({ value: { note: null } });
  });

  it("rejects bad input", () => {
    for (const body of [
      undefined,
      null,
      {},
      { shiftId: "", type: "give" },
      { shiftId: "s1", type: "steal" },
      { shiftId: "s1", type: "give", requestedShiftId: "s2" },
      { shiftId: "s1", type: "give", targetUserId: 5 },
      { shiftId: "s1", type: "give", note: "x".repeat(201) },
    ]) {
      expect(validateOffer(body)).toEqual({ ok: false, error: "invalid" });
    }
  });
});

describe("validateAccept", () => {
  it("accepts an optional counter shift", () => {
    expect(validateAccept(undefined)).toEqual({ ok: true, value: { shiftId: null } });
    expect(validateAccept({ shiftId: "s2" })).toEqual({ ok: true, value: { shiftId: "s2" } });
    expect(validateAccept({ shiftId: 3 })).toEqual({ ok: false, error: "invalid" });
  });
});
