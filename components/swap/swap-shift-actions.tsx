"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useShiftSignups } from "@/hooks/useShiftSignups";
import { useSwapCalendarState } from "@/hooks/useSwaps";
import { ForceSheet } from "@/components/swap/force-sheet";

/** Swap board entry points for a duty: offer one's own Platz, see an open offer. */
export function SwapShiftActions({ shiftId, calendarId }: { shiftId: string; calendarId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const { user } = useAuth();
  const { dutyShiftIds, openOfferShiftIds, canForce } = useSwapCalendarState(calendarId);
  const [forcing, setForcing] = useState<{ id: string; name: string } | null>(null);
  const isDuty = dutyShiftIds.has(shiftId);
  // Plain shifts never show swap actions, so do not fetch their signups.
  const { signups } = useShiftSignups(isDuty ? shiftId : undefined);

  if (!user || !isDuty) return null;
  const mine = signups.some((s) => s.id === user.id);
  const hasOffer = openOfferShiftIds.has(shiftId);
  if (!mine && !hasOffer && !(canForce && signups.length > 0)) return null;

  return (
    <section className="flex flex-col gap-2 rounded-[11px] border border-line bg-surface-panel p-3.5">
      {hasOffer && <p className="text-[13px] text-fg-secondary">{t("swap.openOffer")}</p>}
      {(mine || hasOffer) && (
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
      )}
      {canForce && signups.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
          <p className="text-[13px] text-fg-secondary">{t("swap.force.hint")}</p>
          <div className="flex flex-wrap gap-2">
            {signups.map((s) => (
              <Button key={s.id} type="button" size="sm" variant="outline" onClick={() => setForcing({ id: s.id, name: s.name ?? "?" })}>
                <ShieldAlert className="size-4" />
                {t("swap.force.forUser", { name: s.name ?? "?" })}
              </Button>
            ))}
          </div>
        </div>
      )}
      {forcing && (
        <ForceSheet
          open
          onOpenChange={(open) => !open && setForcing(null)}
          calendarId={calendarId}
          shiftId={shiftId}
          absent={forcing}
          holderIds={signups.map((s) => s.id)}
        />
      )}
    </section>
  );
}
