"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useShiftSignups } from "@/hooks/useShiftSignups";
import { useSwapCalendarState } from "@/hooks/useSwaps";

/** Swap board entry points for a duty: offer one's own Platz, see an open offer. */
export function SwapShiftActions({ shiftId, calendarId }: { shiftId: string; calendarId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const { user } = useAuth();
  const { dutyShiftIds, openOfferShiftIds } = useSwapCalendarState(calendarId);
  const { signups } = useShiftSignups(shiftId);

  if (!user || !dutyShiftIds.has(shiftId)) return null;
  const mine = signups.some((s) => s.id === user.id);
  const hasOffer = openOfferShiftIds.has(shiftId);
  if (!mine && !hasOffer) return null;

  return (
    <section className="flex flex-col gap-2 rounded-[11px] border border-line bg-surface-panel p-3.5">
      {hasOffer && <p className="text-[13px] text-fg-secondary">{t("swap.openOffer")}</p>}
      <div className="flex flex-wrap gap-2">
        {mine && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => router.push(`/swaps?offer=${encodeURIComponent(shiftId)}&calendar=${encodeURIComponent(calendarId)}`)}
          >
            <ArrowLeftRight className="size-4" />
            {t("swap.offerShift")}
          </Button>
        )}
        {hasOffer && (
          <Button type="button" size="sm" variant="ghost" onClick={() => router.push("/swaps")}>
            {t("swap.openOfferLink")}
          </Button>
        )}
      </div>
    </section>
  );
}
