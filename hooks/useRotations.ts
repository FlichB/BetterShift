"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { rotationQueryKeys } from "@/lib/rotation/query-keys";
import type { CalendarMember } from "@/lib/types";
import type { GenerationPlan } from "@/lib/rotation/plan";
import type { GenerationSummary, RotationDetail } from "@/lib/rotation/service";
import type { RotationInput } from "@/lib/rotation/validate";

export interface RotationCalendar {
  id: string;
  name: string;
  color: string;
  signupsEnabled: boolean;
  presets: { id: string; title: string; startTime: string; endTime: string }[];
  members: CalendarMember[];
}

export class RotationApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RotationApiError(typeof data.error === "string" ? data.error : "internal", response.status);
  return data as T;
}

export function useRotationCalendars() {
  return useQuery({
    queryKey: rotationQueryKeys.calendars,
    queryFn: () => request<RotationCalendar[]>("/api/rotations/calendars"),
  });
}

export function useRotations(calendarId: string | undefined) {
  return useQuery({
    queryKey: rotationQueryKeys.byCalendar(calendarId ?? ""),
    queryFn: () => request<RotationDetail[]>(`/api/rotations?calendarId=${encodeURIComponent(calendarId!)}`),
    enabled: Boolean(calendarId),
  });
}

export function useSaveRotation() {
  const queryClient = useQueryClient();
  return useMutation<RotationDetail, RotationApiError, { id?: string; input: RotationInput }>({
    mutationFn: ({ id, input }) =>
      request(id ? `/api/rotations/${id}` : "/api/rotations", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(input),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: rotationQueryKeys.all }),
  });
}

export function useDeleteRotation() {
  const queryClient = useQueryClient();
  return useMutation<{ deletedDuties: number }, RotationApiError, { id: string; deleteFutureDuties: boolean }>({
    mutationFn: ({ id, deleteFutureDuties }) =>
      request(`/api/rotations/${id}?deleteFutureDuties=${deleteFutureDuties ? 1 : 0}`, { method: "DELETE" }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: rotationQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
    },
  });
}

export function usePreviewRotation() {
  return useMutation<GenerationPlan, RotationApiError, { id: string; from: string; to: string }>({
    mutationFn: ({ id, from, to }) =>
      request(`/api/rotations/${id}/preview`, { method: "POST", body: JSON.stringify({ from, to }) }),
  });
}

export function useGenerateRotation() {
  const queryClient = useQueryClient();
  return useMutation<GenerationSummary, RotationApiError, { id: string; from: string; to: string }>({
    mutationFn: ({ id, from, to }) =>
      request(`/api/rotations/${id}/generate`, { method: "POST", body: JSON.stringify({ from, to }) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all }),
  });
}

export function useRemoveSlotLock() {
  return useMutation<void, RotationApiError, { id: string; shiftId: string; userId: string }>({
    mutationFn: ({ id, shiftId, userId }) =>
      request(`/api/rotations/${id}/locks`, { method: "DELETE", body: JSON.stringify({ shiftId, userId }) }),
  });
}

export async function fetchSuggestedOffset(id: string, date: string, memberIds: string[]): Promise<number> {
  const params = new URLSearchParams({ date, memberIds: memberIds.join(",") });
  const { startOffset } = await request<{ startOffset: number }>(`/api/rotations/${id}/suggest-offset?${params}`);
  return startOffset;
}
