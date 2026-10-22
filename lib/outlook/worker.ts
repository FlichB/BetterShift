// [fork] In-process scheduler for the Outlook sync and the notification outbox (spec 12.25).
// Same single-instance assumption as autoSyncService: no coordination across replicas.
import { logSystemEvent } from "@/lib/audit-log";
import { formatDateToLocal } from "@/lib/date-utils";
import { dispatchNotifications } from "@/lib/notify/dispatch";
import { renderEventBody } from "@/lib/notify/render";
import { getMailTranslator } from "@/lib/notify/translator";
import type { OutlookAuthFailedMetadata } from "@/lib/outlook/audit";
import { getOutlookConfig } from "@/lib/outlook/config";
import { graphClientFor, type GraphClient } from "@/lib/outlook/graph-client";
import { syncOutlook, verifyOutlook, type SyncFailure } from "@/lib/outlook/sync";

const AUTH_PAUSE_MINUTES = 15;
const KICK_DEBOUNCE_MS = 2_000;
const FULL_RUN_HOUR = 3;

interface WorkerState {
  interval: ReturnType<typeof setInterval> | null;
  kickTimer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  rerun: boolean;
  pausedUntil: number;
  lastFullRunDate: string | null;
  client: GraphClient | null;
}

// Next.js may load instrumentation.ts and route handlers as separate module instances;
// globalThis lets kick() from a route reach the timer started at boot.
const globalWorker = globalThis as typeof globalThis & { __bettershiftOutlookWorker?: WorkerState };
const state: WorkerState = (globalWorker.__bettershiftOutlookWorker ??= {
  interval: null,
  kickTimer: null,
  running: null,
  rerun: false,
  pausedUntil: 0,
  lastFullRunDate: null,
  client: null,
});

/** The nightly full reconcile runs on the first tick at or after 03:00 local time each day. */
export function isFullRunDue(lastDate: string | null, now: Date): boolean {
  return now.getHours() >= FULL_RUN_HOUR && formatDateToLocal(now) !== lastDate;
}

async function pause(message: string): Promise<void> {
  state.pausedUntil = Date.now() + AUTH_PAUSE_MINUTES * 60_000;
  state.client = null; // pick up fresh credentials after the pause
  console.error(`[Outlook] Graph rejected the credentials, pausing ${AUTH_PAUSE_MINUTES} minutes: ${message}`);
  await logSystemEvent<OutlookAuthFailedMetadata>({
    action: "outlook.auth_failed",
    resourceType: "outlook",
    metadata: { message, pausedMinutes: AUTH_PAUSE_MINUTES },
  });
}

async function logFailures(failures: SyncFailure[]): Promise<void> {
  for (const failure of failures) {
    await logSystemEvent<SyncFailure>({
      action: "outlook.sync_failed",
      resourceType: "rotation",
      resourceId: failure.rotationId,
      metadata: failure,
    });
  }
}

async function runOnce(): Promise<void> {
  const config = getOutlookConfig();
  if (!config || Date.now() < state.pausedUntil) return;
  const client = (state.client ??= graphClientFor(config));
  const now = new Date();

  if (isFullRunDue(state.lastFullRunDate, now)) {
    const verified = await verifyOutlook(client, now);
    if (verified.authError) return pause(verified.authError);
    if (!verified.throttled) state.lastFullRunDate = formatDateToLocal(now);
  }

  const { t } = await getMailTranslator();
  const sync = await syncOutlook(client, now, {
    bodyHtml: renderEventBody(t, config.appUrl),
    cancelComment: t("outlook.cancelComment"),
  });
  // Audit logging must never skip the auth pause below.
  await logFailures(sync.failures).catch((error) => console.error("[Outlook] Logging sync failures failed:", error));
  if (sync.authError) return pause(sync.authError);

  const mails = await dispatchNotifications(client, config, now);
  if (mails.authError) return pause(mails.authError);
  if (sync.remaining > 0) state.rerun = true;
}

function run(): Promise<void> {
  if (state.running) {
    state.rerun = true;
    return state.running;
  }
  state.running = runOnce()
    .catch((error) => console.error("[Outlook] Sync run failed:", error))
    .finally(() => {
      state.running = null;
      if (state.rerun) {
        state.rerun = false;
        outlookWorker.kick();
      }
    });
  return state.running;
}

export const outlookWorker = {
  start(): void {
    const config = getOutlookConfig();
    if (!config || state.interval) return;
    if (config.dryRun) console.info("[Outlook] Dry-run mode: Graph calls are only logged.");
    void run();
    state.interval = setInterval(() => void run(), config.intervalMs);
    state.interval.unref?.();
  },
  stop(): void {
    if (state.interval) clearInterval(state.interval);
    if (state.kickTimer) clearTimeout(state.kickTimer);
    state.interval = null;
    state.kickTimer = null;
  },
  /** Debounced run after a change made through fork code; no-op while the worker is not running. */
  kick(): void {
    if (!state.interval || state.kickTimer) return;
    state.kickTimer = setTimeout(() => {
      state.kickTimer = null;
      void run();
    }, KICK_DEBOUNCE_MS);
    state.kickTimer.unref?.();
  },
};
