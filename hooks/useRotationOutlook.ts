"use client";

// [fork] Outlook switch and sync status of a rotation (spec 12.24).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotationApiError } from "@/hooks/useRotations";
import type { OutlookStatus } from "@/lib/outlook/rotation";
import { rotationQueryKeys } from "@/lib/rotation/query-keys";

const STATUS_REFRESH_MS = 15_000;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RotationApiError(typeof data.error === "string" ? data.error : "internal", response.status);
  return data as T;
}

export function useOutlookStatus(rotationId: string) {
  return useQuery({
    queryKey: rotationQueryKeys.outlook(rotationId),
    queryFn: () => request<OutlookStatus>(`/api/rotations/${rotationId}/outlook`),
    refetchInterval: STATUS_REFRESH_MS,
  });
}

export function useSetOutlookEnabled(rotationId: string) {
  const queryClient = useQueryClient();
  const key = rotationQueryKeys.outlook(rotationId);
  return useMutation<OutlookStatus, RotationApiError, boolean, { previous?: OutlookStatus }>({
    mutationFn: (enabled) => request(`/api/rotations/${rotationId}/outlook`, { method: "PUT", body: JSON.stringify({ enabled }) }),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<OutlookStatus>(key);
      if (previous) queryClient.setQueryData<OutlookStatus>(key, { ...previous, enabled });
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useOutlookSyncNow(rotationId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ ok: true }, RotationApiError, void>({
    mutationFn: () => request(`/api/rotations/${rotationId}/outlook/sync`, { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: rotationQueryKeys.outlook(rotationId) }),
  });
}
