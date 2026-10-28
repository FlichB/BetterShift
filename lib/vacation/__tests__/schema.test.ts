// [fork] Urlaub tables (SPEC 12.43).
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getPreferences } from "@/lib/notify/preferences";
import { vacationChanges, vacationOutbox, vacations } from "@/lib/vacation/schema";
import { createUser } from "@/tests/helpers/seed";

describe("vacation schema", () => {
  it("stores a vacation, a change request and an outbox row", () => {
    const u = createUser("Urlauber");
    const v = db.insert(vacations).values({ userId: u, startDate: "2027-07-05", endDate: "2027-07-16", status: "pending", requestedBy: u }).returning().get();
    expect(v.note).toBeNull();
    const c = db.insert(vacationChanges).values({ vacationId: v.id, kind: "cancel", status: "pending", requestedBy: u }).returning().get();
    expect(c.startDate).toBeNull();
    db.insert(vacationOutbox).values({ kind: "vacation_requested", vacationId: v.id, actorUserId: u }).run();
    expect(db.select().from(vacationOutbox).where(eq(vacationOutbox.vacationId, v.id)).get()?.status).toBe("pending");
  });

  it("allows only one pending change per vacation", () => {
    const u = createUser("Zweifach");
    const v = db.insert(vacations).values({ userId: u, startDate: "2027-08-02", endDate: "2027-08-06", status: "approved", requestedBy: u }).returning().get();
    db.insert(vacationChanges).values({ vacationId: v.id, kind: "cancel", status: "pending", requestedBy: u }).run();
    expect(() => db.insert(vacationChanges).values({ vacationId: v.id, kind: "cancel", status: "pending", requestedBy: u }).run()).toThrow();
    db.insert(vacationChanges).values({ vacationId: v.id, kind: "cancel", status: "rejected", requestedBy: u }).run();
  });

  it("defaults the new mail switches to on", () => {
    const prefs = getPreferences(createUser("Neu"));
    expect(prefs.myVacations).toBe(true);
    expect(prefs.vacationRequests).toBe(true);
  });
});
