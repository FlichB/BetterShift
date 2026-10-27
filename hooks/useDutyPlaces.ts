// [fork] Duty templates and Dienstfreie of every shown calendar, for one calendar entry per Platz (spec 12.32).
"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuthFeatures } from "@/hooks/useAuthFeatures";
import { request } from "@/hooks/useSwaps";
import { LIVE_REFETCH_INTERVAL } from "@/lib/query-client";
import { swapQueryKeys } from "@/lib/swap/query-keys";
import type { CalendarSwapState } from "@/lib/swap/types";
import type { DayOffIndexEntry, DutyPlaceIndex } from "@/lib/rotation/places";

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
  const uniqueKey = unique.join(); // [fork]
  const templates = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of results) for (const [shiftId, template] of Object.entries(r.data?.entryTemplates ?? {})) map.set(shiftId, template);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- results is a new array every render; data identity is what matters
  }, [dataVersion]);
  // [fork] Dienstfreie by date, each tagged with the calendar its state came from
  const dayOffs = useMemo(() => {
    const map = new Map<string, DayOffIndexEntry[]>();
    const ids = uniqueKey.split(",");
    results.forEach((r, i) => {
      for (const d of r.data?.dayOffs ?? []) {
        const entry = { id: d.id, calendarId: ids[i], title: d.title };
        const list = map.get(d.date);
        if (list) list.push(entry);
        else map.set(d.date, [entry]);
      }
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see templates above; uniqueKey orders the same results
  }, [dataVersion, uniqueKey]);
  const index = useMemo(() => ({ templates, dayOffs }), [templates, dayOffs]);
  return useMemo(() => ({ index, openLabel: t("swap.openPlace") }), [index, t]);
}
