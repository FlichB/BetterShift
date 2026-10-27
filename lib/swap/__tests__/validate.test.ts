import { describe, expect, it } from "vitest";
import { validateAccept, validateOffer } from "@/lib/swap/validate";

describe("validateOffer", () => {
  it("normalises a minimal exchange", () => {
    expect(validateOffer({ shiftId: "s1", type: "exchange" })).toEqual({
      ok: true,
      value: { shiftId: "s1", type: "exchange", targetUserId: null, requestedShiftId: null, note: null },
    });
  });

  it("accepts only exchanges", () => {
    expect(validateOffer({ shiftId: "s", type: "give" }).ok).toBe(false);
    expect(validateOffer({ shiftId: "s", type: "forced" }).ok).toBe(false);
    expect(validateOffer({ shiftId: "s", type: "exchange" }).ok).toBe(true);
  });

  it("trims the note and drops empty ones", () => {
    expect(validateOffer({ shiftId: "s1", type: "exchange", note: "  Urlaub " })).toMatchObject({ value: { note: "Urlaub" } });
    expect(validateOffer({ shiftId: "s1", type: "exchange", note: "  " })).toMatchObject({ value: { note: null } });
  });

  it("rejects bad input", () => {
    for (const body of [
      undefined,
      null,
      {},
      { shiftId: "", type: "exchange" },
      { shiftId: "s1", type: "steal" },
      { shiftId: "s1", type: "give" },
      { shiftId: "s1", type: "exchange", targetUserId: 5 },
      { shiftId: "s1", type: "exchange", note: "x".repeat(201) },
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
