// [fork] Urlaub query keys.
export const vacationQueryKeys = {
  all: ["vacations"] as const,
  board: (year: number) => ["vacations", "board", year] as const,
};
