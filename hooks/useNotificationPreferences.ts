"use client";

// [fork] Own swap-notification switches (spec 12.27); optimistic like hooks/useShifts.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyQueryKeys } from "@/lib/notify/query-keys";
import type { NotificationPreferences, NotificationSettings } from "@/lib/notify/types";

export class NotificationApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/notifications/preferences", {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new NotificationApiError(typeof data.error === "string" ? data.error : "internal", response.status);
  return data as T;
}

export function useNotificationSettings(enabled: boolean) {
  return useQuery({
    queryKey: notifyQueryKeys.preferences,
    queryFn: () => request<NotificationSettings>(),
    enabled,
  });
}

export function useSaveNotificationPreferences() {
  const queryClient = useQueryClient();
  const key = notifyQueryKeys.preferences;
  return useMutation<NotificationSettings, NotificationApiError, NotificationPreferences, { previous?: NotificationSettings }>({
    mutationFn: (preferences) => request({ method: "PUT", body: JSON.stringify(preferences) }),
    onMutate: async (preferences) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationSettings>(key);
      if (previous) queryClient.setQueryData<NotificationSettings>(key, { ...previous, preferences });
      return { previous };
    },
    onError: (_error, _preferences, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
