"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useCounterCandidates } from "@/hooks/useSwaps";
import { useDutyFormat, useLocalDateFormat } from "@/components/swap/use-duty-format";
import type { BoardEntry } from "@/lib/swap/types";
import { cn } from "@/lib/utils";

/** Picks the counter duty of a forced swap from the server's candidates (spec D6). */
export function CounterDialog({
  entry,
  onCancel,
  onConfirm,
}: {
  entry: BoardEntry;
  onCancel: () => void;
  onConfirm: (shiftId: string) => void;
}) {
  const t = useTranslations();
  const fmt = useDutyFormat();
  const fmtDate = useLocalDateFormat();
  const candidates = useCounterCandidates(entry.id);
  const [shiftId, setShiftId] = useState<string>();
  const duties = candidates.data?.duties ?? [];
  const end = fmtDate(candidates.data?.windowEnd ?? entry.counterWindowEnd ?? entry.offered.date);

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t("swap.counter.title")}
      description={t("swap.counter.text", { name: entry.offeredBy.name ?? "?", end })}
      confirmText={t("swap.counter.choose")}
      confirmDisabled={!shiftId}
      onConfirm={() => shiftId && onConfirm(shiftId)}
    >
      <div role="radiogroup" aria-label={t("swap.counter.title")} className="flex flex-col gap-1.5">
        {candidates.isLoading && <p className="text-[13px] text-fg-secondary">{t("swap.counter.loading")}</p>}
        {!candidates.isLoading && duties.length === 0 && <p className="text-[13px] text-fg-secondary">{t("swap.counter.none")}</p>}
        {duties.map((duty) => {
          const f = fmt(duty);
          const selected = duty.shiftId === shiftId;
          return (
            <button
              key={duty.shiftId}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setShiftId(duty.shiftId)}
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
    </ConfirmationDialog>
  );
}
