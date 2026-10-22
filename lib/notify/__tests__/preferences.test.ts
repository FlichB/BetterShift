import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, getPreferences, preferenceFor, setPreferences, validatePreferences } from "@/lib/notify/preferences";
import { createUser } from "@/tests/helpers/seed";

describe("notification preferences", () => {
  it("defaults to everything on and stores changes", () => {
    const userId = createUser("Pref");
    expect(getPreferences(userId)).toEqual(DEFAULT_PREFERENCES);
    setPreferences(userId, { offersToAll: false, offersToMe: true, myOffers: true });
    expect(getPreferences(userId)).toEqual({ offersToAll: false, offersToMe: true, myOffers: true });
    setPreferences(userId, { offersToAll: true, offersToMe: false, myOffers: false });
    expect(getPreferences(userId)).toEqual({ offersToAll: true, offersToMe: false, myOffers: false });
  });

  it("maps kinds to switches", () => {
    expect(preferenceFor("offer_to_all")).toBe("offersToAll");
    expect(preferenceFor("offer_to_me")).toBe("offersToMe");
    expect(preferenceFor("offer_accepted")).toBe("myOffers");
    expect(preferenceFor("offer_declined")).toBe("myOffers");
  });

  it("accepts exactly three booleans", () => {
    expect(validatePreferences({ offersToAll: true, offersToMe: false, myOffers: true })).toEqual({
      offersToAll: true,
      offersToMe: false,
      myOffers: true,
    });
    expect(validatePreferences({ offersToAll: "yes", offersToMe: false, myOffers: true })).toBeNull();
    expect(validatePreferences({ offersToAll: true })).toBeNull();
    expect(validatePreferences(null)).toBeNull();
  });
});
