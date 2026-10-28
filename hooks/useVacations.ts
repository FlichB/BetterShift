"use client";

// [fork] Urlaub: board query and mutations (SPEC 12.43). Mutations invalidate everything a replan touches.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request, type SwapApiError } from "@/hooks/useSwaps";
import { dayOffQueryKeys } from "@/lib/dayoff/query-keys";
import { queryKeys } from "@/lib/query-keys";
import { rotationQueryKeys } from "@/lib/rotation/query-keys";
import type { StaffingGap } from "@/lib/staffing/index";
import { swapQueryKeys } from "@/lib/swap/query-keys";
import { vacationQueryKeys } from "@/lib/vacation/query-keys";
import type { VacationAction, VacationBoard, VacationPreview } from "@/lib/vacation/types";

/** `request` sets the JSON content type itself whenever a body is present. */
const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export function useVacationBoard(year: number, enabled = true) {
  return useQuery({
    queryKey: vacationQueryKeys.board(year),
    queryFn: () => request<VacationBoard>(`/api/vacations?year=${year}`),
    enabled,
  });
}

/**
 * Werktage the given range would leave understaffed (SPEC 12.44); only queried for a valid range
 * and while `enabled` (enter mode waits until a person is chosen). Informs, never blocks.
 */
export function useVacationStaffing(startDate: string, endDate: string, userId?: string, enabled = true) {
  return useQuery({
    queryKey: vacationQueryKeys.staffing(userId ?? null, startDate, endDate),
    queryFn: () => request<{ gaps: StaffingGap[] }>("/api/vacations/staffing", send("POST", { startDate, endDate, userId })),
    enabled: enabled && Boolean(startDate && endDate && startDate <= endDate),
    staleTime: 30_000,
  });
}

export function usePreview() {
  return useMutation<VacationPreview, SwapApiError, VacationAction>({
    mutationFn: (action) => request<VacationPreview>("/api/vacations/preview", send("POST", { action })),
  });
}

export interface VacationRangeInput {
  startDate: string;
  endDate: string;
  note: string | null;
}

export interface ChangeRequestInput {
  id: string;
  kind: "change" | "cancel";
  startDate?: string;
  endDate?: string;
  note: string | null;
}

// Not optimistic: the server decides the replan (and may refuse), so the UI waits for the response.
function useVacationMutation<TVars>(mutationFn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation<unknown, SwapApiError, TVars>({
    mutationFn,
    // A replan changes Plätze, Dienstfreie and the calendar; refresh all of it.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: vacationQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: swapQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: dayOffQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all }),
        queryClient.invalidateQueries({ queryKey: rotationQueryKeys.all }),
      ]),
  });
}

export function useVacationMutations() {
  return {
    request: useVacationMutation((b: VacationRangeInput) => request("/api/vacations", send("POST", b))),
    enter: useVacationMutation((b: VacationRangeInput & { userId: string }) => request("/api/vacations", send("POST", b))),
    withdraw: useVacationMutation((id: string) => request(`/api/vacations/${id}/withdraw`, send("POST"))),
    approve: useVacationMutation((id: string) => request(`/api/vacations/${id}/approve`, send("POST"))),
    reject: useVacationMutation((v: { id: string; note: string }) =>
      request(`/api/vacations/${v.id}/reject`, send("POST", { note: v.note }))
    ),
    change: useVacationMutation((v: { id: string; startDate: string; endDate: string }) =>
      request(`/api/vacations/${v.id}`, send("PATCH", { startDate: v.startDate, endDate: v.endDate }))
    ),
    cancel: useVacationMutation((id: string) => request(`/api/vacations/${id}`, send("DELETE"))),
    requestChange: useVacationMutation(({ id, ...body }: ChangeRequestInput) =>
      request(`/api/vacations/${id}/changes`, send("POST", body))
    ),
    approveChange: useVacationMutation((id: string) => request(`/api/vacation-changes/${id}/approve`, send("POST"))),
    rejectChange: useVacationMutation((v: { id: string; note: string }) =>
      request(`/api/vacation-changes/${v.id}/reject`, send("POST", { note: v.note }))
    ),
    withdrawChange: useVacationMutation((id: string) => request(`/api/vacation-changes/${id}/withdraw`, send("POST"))),
  };
}
