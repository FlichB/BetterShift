// [fork] Urlaub route helpers.
import { describe, expect, it } from "vitest";
import { requireManagerOf, STATUS, vacationErrorResponse } from "@/lib/vacation/http";
import { VacationServiceError } from "@/lib/vacation/errors";
import { seedDuties } from "@/lib/swap/__tests__/fixtures";

describe("vacation http", () => {
  it("maps every error code", async () => {
    expect(STATUS.overlap).toBe(409);
    expect(STATUS.forbidden).toBe(403);
    const res = vacationErrorResponse(new VacationServiceError("begun"), "x");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "begun" });
  });

  it("lets only the Verwaltung of the person through", async () => {
    const s = await seedDuties();
    expect(await requireManagerOf(s.team.ownerId, s.m1)).toBeNull();
    expect((await requireManagerOf(s.m2, s.m1))?.status).toBe(403);
  });
});
