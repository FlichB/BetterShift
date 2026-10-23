"use client";

// [fork] The signed-in user's personal feed link (spec 12.20). Not optimistic: the token comes from the server.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { feedQueryKeys } from "@/lib/feed/query-keys";
import type { PersonalFeedInfo } from "@/lib/feed/types";

export class PersonalFeedApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfter: number | null = null
  ) {
    super(`personal feed request failed: ${status}`);
  }
}

const EMPTY_INFO: PersonalFeedInfo = { token: null, url: null, createdAt: null, lastUsedAt: null };

async function request<T>(method: "GET" | "POST" | "DELETE"): Promise<T> {
  const response = await fetch("/api/swaps/feed-token", { method });
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    const data = response.status === 429 ? await response.json().catch(() => ({})) : {};
    throw new PersonalFeedApiError(response.status, typeof data.retryAfter === "number" ? data.retryAfter : null);
  }
  return (await response.json()) as T;
}

export function usePersonalFeed(enabled: boolean) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  return useQuery({
    queryKey: feedQueryKeys.info(userId),
    queryFn: () => request<PersonalFeedInfo>("GET"),
    enabled: enabled && !!userId,
  });
}

export function useRotatePersonalFeed() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const key = feedQueryKeys.info(user?.id ?? "");
  return useMutation<PersonalFeedInfo, PersonalFeedApiError>({
    mutationFn: () => request<PersonalFeedInfo>("POST"),
    onSuccess: (info) => queryClient.setQueryData(key, info),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useRevokePersonalFeed() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const key = feedQueryKeys.info(user?.id ?? "");
  return useMutation<void, PersonalFeedApiError>({
    mutationFn: () => request<void>("DELETE"),
    onSuccess: () => queryClient.setQueryData(key, EMPTY_INFO),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
