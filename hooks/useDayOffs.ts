"use client";

// [fork] Dienstfrei board, move options and mutations (design docs/superpowers/specs/2026-10-27-dienstfrei-design.md).
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request, type SwapApiError } from "@/hooks/useSwaps";
import { LIVE_REFETCH_INTERVAL } from "@/lib/query-client";
import { dayOffQueryKeys } from "@/lib/dayoff/query-keys";
import type { DayOffBoard, MoveOption } from "@/lib/dayoff/types";
import { swapQueryKeys } from "@/lib/swap/query-keys";

export interface DayOffOptionsResponse {
  options: MoveOption[];
  windowEnd: string;
}

export function useDayOffBoard(enabled = true) {
  return useQuery({
    queryKey: dayOffQueryKeys.board,
    queryFn: () => request<DayOffBoard>("/api/day-offs"),
    enabled,
    refetchInterval: LIVE_REFETCH_INTERVAL,
    placeholderData: keepPreviousData,
  });
}

export function useDayOffOptions(id: string | null) {
  return useQuery({
    queryKey: dayOffQueryKeys.options(id ?? ""),
    queryFn: () => request<DayOffOptionsResponse>(`/api/day-offs/${id}/options`),
    enabled: Boolean(id),
  });
}

// Not optimistic: every action is checked server-side (status, start, window) and may
// legitimately fail. The calendar's Dienstfrei entries live in the swap calendar state.
function useDayOffMutation<TVars, TResult = unknown>(mutationFn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation<TResult, SwapApiError, TVars>({
    mutationFn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dayOffQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: swapQueryKeys.all });
    },
  });
}

const post = <T = unknown>(url: string, body?: unknown) =>
  request<T>(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const useMoveDayOff = () =>
  useDayOffMutation(({ id, date }: { id: string; date: string }) => post(`/api/day-offs/${id}/move`, { date }));

export const useLockDayOff = () =>
  useDayOffMutation(({ id, note }: { id: string; note: string | null }) => post(`/api/day-offs/${id}/lock`, { note }));

export const useProposeDayOff = () =>
  useDayOffMutation(({ id, dates }: { id: string; dates: string[] }) => post(`/api/day-offs/${id}/proposals`, { dates }));

export const useCounterDayOff = () =>
  useDayOffMutation(({ id, date, override }: { id: string; date: string; override?: boolean }) =>
    post(`/api/day-offs/${id}/counter`, { date, override })
  );

export const useAcceptDayOffProposal = () =>
  useDayOffMutation(({ id, override }: { id: string; override?: boolean }) =>
    post(`/api/day-offs/proposals/${id}/accept`, override ? { override } : undefined)
  );

export const useDeclineDayOffProposal = () =>
  useDayOffMutation(({ id, reason }: { id: string; reason: string | null }) =>
    post(`/api/day-offs/proposals/${id}/decline`, { reason })
  );
