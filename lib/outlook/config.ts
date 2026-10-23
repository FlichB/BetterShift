// [fork] Outlook / Microsoft 365 settings (spec 12.24). Read on every call so tests can stub the env.
// The secret only lives in the environment, never in the database or in logs.
import { isAuthEnabled } from "@/lib/auth/feature-flags";

export interface OutlookConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  organizer: string;
  intervalMs: number;
  dryRun: boolean;
  appUrl: string;
}

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 15;

const env = (name: string) => process.env[name]?.trim() ?? "";

/** Public base URL without trailing slashes; links in mails, Outlook events and feeds use it. */
export const getAppUrl = (): string => (env("BETTER_AUTH_URL") || "http://localhost:3000").replace(/\/+$/, "");

/** null when the sync is off: auth disabled, no organizer, or credentials missing outside dry-run. */
export function getOutlookConfig(): OutlookConfig | null {
  if (!isAuthEnabled()) return null;
  const organizer = env("OUTLOOK_ORGANIZER");
  const dryRun = env("OUTLOOK_DRY_RUN").toLowerCase() === "true";
  const tenantId = env("OUTLOOK_TENANT_ID");
  const clientId = env("OUTLOOK_CLIENT_ID");
  const clientSecret = env("OUTLOOK_CLIENT_SECRET");
  if (!organizer) return null;
  if (!dryRun && (!tenantId || !clientId || !clientSecret)) return null;

  const raw = env("OUTLOOK_SYNC_INTERVAL_SECONDS");
  const seconds = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  const interval = Number.isFinite(seconds) ? Math.max(MIN_INTERVAL_SECONDS, seconds) : DEFAULT_INTERVAL_SECONDS;
  return {
    tenantId,
    clientId,
    clientSecret,
    organizer,
    intervalMs: interval * 1000,
    dryRun,
    appUrl: getAppUrl(),
  };
}

export const isOutlookConfigured = (): boolean => getOutlookConfig() !== null;
