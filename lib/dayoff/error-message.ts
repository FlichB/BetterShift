// [fork] Dienstfrei: translates a `{ error: code }` route response (see lib/dayoff/http.ts) via dayOff.errors.<code>.
import type { DayOffErrorCode } from "@/lib/dayoff/types";

export function dayOffErrorMessage(t: (key: string) => string, code: DayOffErrorCode): string {
  return t(`dayOff.errors.${code}`);
}
