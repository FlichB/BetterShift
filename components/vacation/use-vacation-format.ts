"use client";

// [fork] Date and status labels for the Urlaub UI; all dates are local YYYY-MM-DD strings.
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { formatDateToLocal, parseLocalDate } from "@/lib/date-utils";
import { getDateLocale } from "@/lib/locales";
import { addDays } from "@/lib/rotation/dates";
import type { VacationStatus } from "@/lib/vacation/types";

export function useVacationFormat() {
  const t = useTranslations();
  const dateLocale = getDateLocale(useLocale());
  const day = (date: string) => format(parseLocalDate(date), "EEE, P", { locale: dateLocale });
  return {
    /** Weekday + full date ("Mo, 07.12.2026"). */
    day,
    /** Compact day ("07.12."), for the calendar list. */
    short: (date: string) => format(parseLocalDate(date), "dd.MM.", { locale: dateLocale }),
    /** "Mo, 07.12.2026 – Fr, 11.12.2026"; a single day shows once. */
    formatRange: (start: string, end: string) => (start === end ? day(start) : `${day(start)} – ${day(end)}`),
    statusLabel: (status: VacationStatus) => {
      switch (status) {
        case "pending":
          return t("vacation.status.pending");
        case "approved":
          return t("vacation.status.approved");
        case "rejected":
          return t("vacation.status.rejected");
        case "withdrawn":
          return t("vacation.status.withdrawn");
        case "cancelled":
          return t("vacation.status.cancelled");
      }
    },
  };
}

export const todayLocal = () => formatDateToLocal(new Date());

/** New vacations and new start dates must lie after today. */
export const tomorrowLocal = () => addDays(todayLocal(), 1);
