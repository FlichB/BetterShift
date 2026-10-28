// [fork] Urlaub query keys.
export const vacationQueryKeys = {
  all: ["vacations"] as const,
  board: (year: number) => ["vacations", "board", year] as const,
  staffing: (userId: string | null, from: string, to: string) => ["vacations", "staffing", userId ?? "me", from, to] as const,
};
