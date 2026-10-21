// [fork] Query keys for rotations; kept beside lib/query-keys.ts to avoid touching it.
export const rotationQueryKeys = {
  all: ["rotations"] as const,
  calendars: ["rotations", "calendars"] as const,
  byCalendar: (calendarId: string) => ["rotations", "calendar", calendarId] as const,
};
