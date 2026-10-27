// [fork] Duty templates of every shown calendar, for one calendar entry per Platz (spec 12.32).
"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuthFeatures } from "@/hooks/useAuthFeatures";
import { request } from "@/hooks/useSwaps";
import { LIVE_REFETCH_INTERVAL } from "@/lib/query-client";
import { swapQueryKeys } from "@/lib/swap/query-keys";
import type { CalendarSwapState } from "@/lib/swap/types";
import type { DutyPlaceIndex } from "@/lib/rotation/places";

export function useDutyPlaces(calendarIds: string[]): { index: DutyPlaceIndex; openLabel: string } {
  const t = useTranslations();
  const { isAuthEnabled } = useAuthFeatures();
  const unique = [...new Set(calendarIds)].sort();
  const results = useQueries({
    queries: unique.map((calendarId) => ({
      queryKey: swapQueryKeys.calendarState(calendarId),
      queryFn: () => request<CalendarSwapState>(`/api/swaps/calendar-state?calendarId=${encodeURIComponent(calendarId)}`),
      enabled: isAuthEnabled,
      refetchInterval: LIVE_REFETCH_INTERVAL,
    })),
  });
  const dataVersion = results.map((r) => r.dataUpdatedAt).join();
  const templates = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of results) for (const [shiftId, template] of Object.entries(r.data?.entryTemplates ?? {})) map.set(shiftId, template);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- results is a new array every render; data identity is what matters
  }, [dataVersion]);
  const index = useMemo(() => ({ templates }), [templates]);
  return useMemo(() => ({ index, openLabel: t("swap.openPlace") }), [index, t]);
}
