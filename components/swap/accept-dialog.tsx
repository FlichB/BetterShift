"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/useAuth";
import { useSwapDuties } from "@/hooks/useSwaps";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useDutyFormat } from "@/components/swap/use-duty-format";
import type { BoardEntry } from "@/lib/swap/types";
import { cn } from "@/lib/utils";

/** Confirms an acceptance; for "Tausch beliebig" the acceptor first picks a counter duty. */
export function AcceptDialog({
  entry,
  onCancel,
  onConfirm,
}: {
  entry: BoardEntry;
  onCancel: () => void;
  onConfirm: (counterShiftId?: string) => void;
}) {
  const t = useTranslations();
  const fmt = useDutyFormat();
  const { user } = useAuth();
  const pickCounter = entry.type === "exchange" && !entry.requested;
  const duties = useSwapDuties(pickCounter ? entry.offered.calendarId : undefined);
  const [counterId, setCounterId] = useState<string>();

  const mySlots = (duties.data?.duties ?? []).filter(
    (d) => d.shiftId !== entry.offered.shiftId &&
      d.holders.some((h) => h.id === user?.id) &&
      !d.holders.some((h) => h.id === entry.offeredBy.id)
  );
  const counter = entry.requested ?? mySlots.find((d) => d.shiftId === counterId);
  const offered = fmt(entry.offered);
  const description =
    entry.type === "give"
      ? t("swap.confirm.takeText", offered)
      : counter
        ? t("swap.confirm.swapText", { ...offered, counter: `${fmt(counter).date}, ${fmt(counter).time}` })
        : t("swap.confirm.pickCounter");

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={entry.type === "give" ? t("swap.confirm.takeTitle") : t("swap.confirm.swapTitle")}
      description={description}
      confirmText={entry.type === "give" ? t("swap.actions.take") : t("swap.actions.swap")}
      confirmDisabled={pickCounter && !counterId}
      onConfirm={() => onConfirm(pickCounter ? counterId : undefined)}
    >
      {pickCounter && (
        <div role="radiogroup" aria-label={t("swap.confirm.pickCounter")} className="flex flex-col gap-1.5">
          {mySlots.length === 0 && !duties.isLoading && (
            <p className="text-[13px] text-fg-secondary">{t("swap.confirm.noCounter")}</p>
          )}
          {mySlots.map((slot) => {
            const f = fmt(slot);
            const selected = slot.shiftId === counterId;
            return (
              <button
                key={slot.shiftId}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setCounterId(slot.shiftId)}
                className={cn(
                  "rounded-[9px] border px-3 py-2 text-left text-[14px]",
                  selected ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface-card"
                )}
              >
                {f.date} · {f.time}
              </button>
            );
          })}
        </div>
      )}
    </ConfirmationDialog>
  );
}
