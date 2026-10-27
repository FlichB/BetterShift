// [fork] Query keys for the Dienstfrei board; kept beside lib/query-keys.ts to avoid touching it.
export const dayOffQueryKeys = {
  all: ["day-offs"] as const,
  board: ["day-offs", "board"] as const,
  options: (id: string) => ["day-offs", "options", id] as const,
};
