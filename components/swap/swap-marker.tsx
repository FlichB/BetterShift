"use client";

import { useTranslations } from "next-intl";
import { ArrowLeftRight } from "lucide-react";
import { useSwapCalendarState } from "@/hooks/useSwaps";

/** Subtle icon on a duty with an open swap offer. */
export function SwapMarker({ shiftId, calendarId }: { shiftId: string; calendarId: string }) {
  const t = useTranslations();
  const { openOfferShiftIds } = useSwapCalendarState(calendarId);
  if (!openOfferShiftIds.has(shiftId)) return null;
  return (
    <span role="img" aria-label={t("swap.marker")} title={t("swap.marker")} className="flex shrink-0 items-center">
      <ArrowLeftRight className="size-3 opacity-70" aria-hidden="true" />
    </span>
  );
}
