"use client";

import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { getDateLocale } from "@/lib/locales";
import type { DutyInfo } from "@/lib/swap/types";

export function useDutyFormat() {
  const locale = useLocale();
  const t = useTranslations();
  const dateLocale = getDateLocale(locale);
  return (duty: DutyInfo) => ({
    date: format(parseLocalDate(duty.date), "EEE P", { locale: dateLocale }),
    time: duty.isAllDay ? t("calendarView.allDayShort") : `${duty.startTime}–${duty.endTime}`,
  });
}

/** A local YYYY-MM-DD as short weekday + date, matching useDutyFormat. */
export function useLocalDateFormat() {
  const dateLocale = getDateLocale(useLocale());
  return (date: string) => format(parseLocalDate(date), "EEE P", { locale: dateLocale });
}
