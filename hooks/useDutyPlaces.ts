// [fork] Duty templates, Dienstfreie and Urlaube of every shown calendar, for one calendar entry per Platz (spec 12.32).
"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuthFeatures } from "@/hooks/useAuthFeatures";
import { request } from "@/hooks/useSwaps";
import { LIVE_REFETCH_INTERVAL } from "@/lib/query-client";
import { swapQueryKeys } from "@/lib/swap/query-keys";
import type { CalendarSwapState } from "@/lib/swap/types";
import { useCalendars } from "@/hooks/useCalendars";
import { vacationIndexEntries, type CalendarRef, type DayOffIndexEntry, type DutyPlaceIndex } from "@/lib/rotation/places"; // [fork] vacationIndexEntries

export interface DutyPlaces {
  index: DutyPlaceIndex;
  openLabel: string;
  /** Calendars whose Dienstfreie the grid shows, whether or not any of their shifts is in view. */
  dayOffCalendars: CalendarRef[];
}

/** `dayOffCalendarId`: the calendar the workspace shows; omitted (compare mode) means no Dienstfreie. */
export function useDutyPlaces(calendarIds: string[], dayOffCalendarId?: string): DutyPlaces {
  const t = useTranslations();
  const { isAuthEnabled } = useAuthFeatures();
  const { calendars } = useCalendars();
  const unique = [...new Set(dayOffCalendarId ? [...calendarIds, dayOffCalendarId] : calendarIds)].sort();
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
      // [fork] Urlaub: one entry per day of each vacation
      for (const [date, entries] of vacationIndexEntries(r.data?.vacations ?? [], ids[i], (name) => t("vacation.entryTitle", { name }))) {
        const list = map.get(date);
        if (list) list.push(...entries);
        else map.set(date, entries);
      }
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see templates above; uniqueKey orders the same results, t only changes with the locale
  }, [dataVersion, uniqueKey, t]);
  const index = useMemo(() => ({ templates, dayOffs }), [templates, dayOffs]);
  const dayOffCalendar = calendars.find((c) => c.id === dayOffCalendarId);
  const dayOffName = dayOffCalendar?.name ?? "";
  const dayOffColor = dayOffCalendar?.color ?? "";
  const dayOffCalendars = useMemo<CalendarRef[]>(
    () => (dayOffCalendarId ? [{ id: dayOffCalendarId, name: dayOffName, color: dayOffColor }] : []),
    [dayOffCalendarId, dayOffName, dayOffColor]
  );
  return useMemo(() => ({ index, openLabel: t("swap.openPlace"), dayOffCalendars }), [index, t, dayOffCalendars]);
}
