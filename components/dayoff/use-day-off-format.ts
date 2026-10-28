"use client";

// [fork] Date labels for the Dienstfrei UI; all dates are local YYYY-MM-DD strings.
import { useLocale } from "next-intl";
import { format } from "date-fns";
import { formatDateToLocal, parseLocalDate } from "@/lib/date-utils";
import { getDateLocale } from "@/lib/locales";
import { addDays } from "@/lib/rotation/dates";

export function useDayOffFormat() {
  const dateLocale = getDateLocale(useLocale());
  return {
    /** Weekday + full date, matching the swap cards. */
    long: (date: string) => format(parseLocalDate(date), "EEE P", { locale: dateLocale }),
    /** Compact chip label ("Mi 11.11."). */
    short: (date: string) => format(parseLocalDate(date), "EEEEEE dd.MM.", { locale: dateLocale }),
  };
}

/** The earliest date a proposal may name: a Dienstfrei that has begun can no longer change. */
export function tomorrowLocal(): string {
  return addDays(formatDateToLocal(new Date()), 1);
}
