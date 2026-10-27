// [fork] Hourly in-process job for Dienstfrei: reconcile, remind, and nudge the mail worker.
import { reconcileAll, sendReminders } from "@/lib/dayoff/service";
import { outlookWorker } from "@/lib/outlook/worker";

const HOUR_MS = 3_600_000;
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  try {
    const now = new Date();
    reconcileAll(now);
    sendReminders(now);
    outlookWorker.kick();
  } catch (error) {
    console.error("[DayOffJob] Hourly run failed:", error);
  }
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
