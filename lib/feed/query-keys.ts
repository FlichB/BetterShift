// [fork] TanStack Query key for the personal feed link, scoped to the signed-in user.
export const feedQueryKeys = {
  info: (userId: string) => ["personal-feed", userId] as const,
};
