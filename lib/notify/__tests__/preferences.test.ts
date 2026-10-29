import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, getPreferences, preferenceFor, setPreferences, validatePreferences } from "@/lib/notify/preferences";
import { createUser } from "@/tests/helpers/seed";

describe("notification preferences", () => {
  it("defaults to everything on and stores changes", () => {
    const userId = createUser("Pref");
    expect(getPreferences(userId)).toEqual(DEFAULT_PREFERENCES);
    setPreferences(userId, { offersToAll: false, offersToMe: true, myOffers: true, myDayOffs: true, dayOffRequests: false, myVacations: true, vacationRequests: true });
    expect(getPreferences(userId)).toEqual({ offersToAll: false, offersToMe: true, myOffers: true, myDayOffs: true, dayOffRequests: false, myVacations: true, vacationRequests: true });
    setPreferences(userId, { offersToAll: true, offersToMe: false, myOffers: false, myDayOffs: false, dayOffRequests: true, myVacations: true, vacationRequests: true });
    expect(getPreferences(userId)).toEqual({ offersToAll: true, offersToMe: false, myOffers: false, myDayOffs: false, dayOffRequests: true, myVacations: true, vacationRequests: true });
  });

  it("maps kinds to switches", () => {
    expect(preferenceFor("offer_to_all")).toBe("offersToAll");
    expect(preferenceFor("offer_to_me")).toBe("offersToMe");
    expect(preferenceFor("offer_accepted")).toBe("myOffers");
    expect(preferenceFor("offer_declined")).toBe("myOffers");
  });

  it("accepts exactly seven booleans", () => {
    const all = { offersToAll: true, offersToMe: false, myOffers: true, myDayOffs: false, dayOffRequests: true, myVacations: true, vacationRequests: true };
    expect(validatePreferences(all)).toEqual(all);
    expect(validatePreferences({ offersToAll: true, offersToMe: false, myOffers: true })).toBeNull();
    expect(validatePreferences({ ...all, offersToAll: "yes" })).toBeNull();
    expect(validatePreferences({ offersToAll: true })).toBeNull();
    expect(validatePreferences(null)).toBeNull();
  });
});
