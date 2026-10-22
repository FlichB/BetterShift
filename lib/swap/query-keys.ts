// [fork] Query keys for the swap board; kept beside lib/query-keys.ts to avoid touching it.
export const swapQueryKeys = {
  all: ["swaps"] as const,
  board: (includeHidden: boolean) => ["swaps", "board", includeHidden] as const,
  duties: (calendarId: string) => ["swaps", "duties", calendarId] as const,
  calendarState: (calendarId: string) => ["swaps", "calendar-state", calendarId] as const,
};
