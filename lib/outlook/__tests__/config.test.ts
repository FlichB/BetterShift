import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppUrl, getOutlookConfig, isOutlookConfigured } from "@/lib/outlook/config";

afterEach(() => vi.unstubAllEnvs());

function stubCredentials() {
  vi.stubEnv("OUTLOOK_TENANT_ID", "tenant");
  vi.stubEnv("OUTLOOK_CLIENT_ID", "client");
  vi.stubEnv("OUTLOOK_CLIENT_SECRET", "secret");
  vi.stubEnv("OUTLOOK_ORGANIZER", "office@firma.at");
}

describe("getOutlookConfig", () => {
  it("is off without env", () => {
    expect(getOutlookConfig()).toBeNull();
    expect(isOutlookConfigured()).toBe(false);
  });

  it("needs all credentials outside dry-run", () => {
    stubCredentials();
    vi.stubEnv("OUTLOOK_CLIENT_SECRET", "");
    expect(getOutlookConfig()).toBeNull();
  });

  it("reads a complete configuration with defaults", () => {
    stubCredentials();
    vi.stubEnv("BETTER_AUTH_URL", "https://shift.firma.at/");
    expect(getOutlookConfig()).toEqual({
      tenantId: "tenant",
      clientId: "client",
      clientSecret: "secret",
      organizer: "office@firma.at",
      intervalMs: 60_000,
      dryRun: false,
      appUrl: "https://shift.firma.at",
    });
  });

  it("allows dry-run with only an organizer and clamps the interval", () => {
    vi.stubEnv("OUTLOOK_ORGANIZER", "office@firma.at");
    vi.stubEnv("OUTLOOK_DRY_RUN", "true");
    vi.stubEnv("OUTLOOK_SYNC_INTERVAL_SECONDS", "5");
    expect(getOutlookConfig()).toMatchObject({ dryRun: true, intervalMs: 15_000 });
  });

  it("is off without an organizer even in dry-run", () => {
    vi.stubEnv("OUTLOOK_DRY_RUN", "true");
    expect(getOutlookConfig()).toBeNull();
  });

  it("derives the app URL from BETTER_AUTH_URL without trailing slashes", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://plan.example//");
    expect(getAppUrl()).toBe("https://plan.example");
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(getAppUrl()).toBe("http://localhost:3000");
  });
});
