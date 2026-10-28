// [fork] Hourly in-process job for Dienstfrei: reconcile, remind, and nudge the mail worker.
import { reconcileAll, sendReminders } from "@/lib/dayoff/service";
import { outlookWorker } from "@/lib/outlook/worker";

const HOUR_MS = 3_600_000;
let timer: ReturnType<typeof setInterval> | null = null;

/** Runs one step of the hourly job; a failing step is logged and never skips the next ones. */
function step(name: string, run: () => unknown): void {
  try {
    run();
  } catch (error) {
    console.error(`[DayOffJob] ${name} failed:`, error);
  }
}

function tick(): void {
  const now = new Date();
  step("Reconcile", () => reconcileAll(now));
  step("Reminders", () => sendReminders(now));
  step("Mail kick", () => outlookWorker.kick());
}

export const dayOffJob = {
  start(): void {
    if (timer) return;
    tick();
    timer = setInterval(tick, HOUR_MS);
    timer.unref?.();
  },
  stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  },
};
