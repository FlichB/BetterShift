"use client";

import { useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthFeatures } from "@/hooks/useAuthFeatures";
import { LIVE_REFETCH_INTERVAL } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import { swapQueryKeys } from "@/lib/swap/query-keys";
import type { SlotMove } from "@/lib/swap/rules";
import type { Board, CalendarSwapState, DutiesResponse, SwapType } from "@/lib/swap/types";

export class SwapApiError extends Error {
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
  if (!response.ok) throw new SwapApiError(typeof data.error === "string" ? data.error : "internal", response.status);
  return data as T;
}

export function useSwapBoard(includeHidden: boolean) {
  return useQuery({
    queryKey: swapQueryKeys.board(includeHidden),
    queryFn: () => request<Board>(`/api/swaps${includeHidden ? "?hidden=1" : ""}`),
    refetchInterval: LIVE_REFETCH_INTERVAL,
    placeholderData: keepPreviousData,
  });
}

export function useSwapDuties(calendarId: string | undefined) {
  return useQuery({
    queryKey: swapQueryKeys.duties(calendarId ?? ""),
    queryFn: () => request<DutiesResponse>(`/api/swaps/duties?calendarId=${encodeURIComponent(calendarId!)}`),
    enabled: Boolean(calendarId),
  });
}

/** Which shifts are duties and which carry an open offer; empty when auth is off. */
export function useSwapCalendarState(calendarId: string | undefined) {
  const { isAuthEnabled } = useAuthFeatures();
  const { data } = useQuery({
    queryKey: swapQueryKeys.calendarState(calendarId ?? ""),
    queryFn: () => request<CalendarSwapState>(`/api/swaps/calendar-state?calendarId=${encodeURIComponent(calendarId!)}`),
    enabled: Boolean(calendarId) && isAuthEnabled,
    refetchInterval: LIVE_REFETCH_INTERVAL,
  });
  return useMemo(
    () => ({
      dutyShiftIds: new Set(data?.dutyShiftIds ?? []),
      openOfferShiftIds: new Set(data?.openOfferShiftIds ?? []),
    }),
    [data]
  );
}

// Swaps are not applied optimistically: acceptance is checked server-side
// (ownership, start, Doppelbelegung) and may legitimately fail.
function useSwapMutation<TVars, TResult = unknown>(mutationFn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation<TResult, SwapApiError, TVars>({
    mutationFn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: swapQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
      queryClient.invalidateQueries({ queryKey: ["shift-signups"] });
    },
  });
}

export interface CreateSwapInput {
  shiftId: string;
  type: SwapType;
  targetUserId: string | null;
  requestedShiftId: string | null;
  note: string | null;
}

export const useCreateSwap = () =>
  useSwapMutation((input: CreateSwapInput) => request("/api/swaps", { method: "POST", body: JSON.stringify(input) }));

export const useAcceptSwap = () =>
  useSwapMutation(({ id, shiftId }: { id: string; shiftId?: string }) =>
    request<{ moves: SlotMove[] }>(`/api/swaps/${id}/accept`, {
      method: "POST",
      body: JSON.stringify({ shiftId: shiftId ?? null }),
    })
  );

export const useDeclineSwap = () =>
  useSwapMutation(({ id }: { id: string }) => request(`/api/swaps/${id}/decline`, { method: "POST" }));

export const useWithdrawSwap = () =>
  useSwapMutation(({ id }: { id: string }) => request(`/api/swaps/${id}/withdraw`, { method: "POST" }));

export const useHideSwap = () =>
  useSwapMutation(({ id, hidden }: { id: string; hidden: boolean }) =>
    request(`/api/swaps/${id}/hide`, { method: hidden ? "POST" : "DELETE" })
  );
