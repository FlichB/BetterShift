// [fork] Spec 12.19: reads settle due offers immediately; this hourly
// in-process timer additionally sets and logs them when nobody looks.
import { expireDue } from "@/lib/swap/service";

const HOUR_MS = 3_600_000;
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  try {
    expireDue(new Date());
  } catch (error) {
    console.error("[SwapExpiry] Failed to expire offers:", error);
  }
}

export const swapExpiryService = {
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
