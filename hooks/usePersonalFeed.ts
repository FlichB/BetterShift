"use client";

// [fork] The signed-in user's personal feed link (spec 12.20). Not optimistic: the token comes from the server.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { feedQueryKeys } from "@/lib/feed/query-keys";
import type { PersonalFeedInfo } from "@/lib/feed/types";

export class PersonalFeedApiError extends Error {
  constructor(public readonly status: number) {
    super(`personal feed request failed: ${status}`);
  }
}

async function request<T>(method: "GET" | "POST" | "DELETE"): Promise<T> {
  const response = await fetch("/api/swaps/feed-token", { method });
  if (response.status === 204) return undefined as T;
  if (!response.ok) throw new PersonalFeedApiError(response.status);
  return (await response.json()) as T;
}

export function usePersonalFeed(enabled: boolean) {
  return useQuery({ queryKey: feedQueryKeys.info, queryFn: () => request<PersonalFeedInfo>("GET"), enabled });
}

export function useRotatePersonalFeed() {
  const queryClient = useQueryClient();
  return useMutation<PersonalFeedInfo, PersonalFeedApiError>({
    mutationFn: () => request<PersonalFeedInfo>("POST"),
    onSuccess: (info) => queryClient.setQueryData(feedQueryKeys.info, info),
    onSettled: () => queryClient.invalidateQueries({ queryKey: feedQueryKeys.info }),
  });
}

export function useRevokePersonalFeed() {
  const queryClient = useQueryClient();
  return useMutation<void, PersonalFeedApiError>({
    mutationFn: () => request<void>("DELETE"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: feedQueryKeys.info }),
  });
}
