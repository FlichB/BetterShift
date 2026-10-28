"use client";

// [fork] The holder proposes up to five dates for a locked Dienstfrei, or asks to change an agreed one.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inputClass, RowIconButton } from "@/components/form-kit";
import { MAX_DATES_PER_PROPOSAL, type DayOffView } from "@/lib/dayoff/types";
import { tomorrowLocal, useDayOffFormat } from "@/components/dayoff/use-day-off-format";

/** Date rows of the proposal form; valid when every row is filled, unique and inside [min, max]. */
function useProposalDates(min: string, max: string) {
  const [dates, setDates] = useState<string[]>([""]);
  const filled = dates.filter(Boolean);
  const valid =
    filled.length === dates.length &&
    new Set(filled).size === filled.length &&
    filled.every((d) => d >= min && d <= max);
  return {
    dates,
    valid,
    canAdd: dates.length < MAX_DATES_PER_PROPOSAL,
    set: (index: number, value: string) => setDates((list) => list.map((d, i) => (i === index ? value : d))),
    add: () => setDates((list) => (list.length < MAX_DATES_PER_PROPOSAL ? [...list, ""] : list)),
    remove: (index: number) => setDates((list) => (list.length > 1 ? list.filter((_, i) => i !== index) : list)),
  };
}

export function ProposeDialog({
  dayOff,
  onCancel,
  onConfirm,
}: {
  dayOff: DayOffView;
  onCancel: () => void;
  onConfirm: (dates: string[]) => void;
}) {
  const t = useTranslations();
  const fmt = useDayOffFormat();
  const min = tomorrowLocal();
  const form = useProposalDates(min, dayOff.windowEnd);
  const title = dayOff.status === "agreed" ? t("dayOff.actions.changeRequest") : t("dayOff.actions.propose");

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={title}
      description={t("dayOff.propose.text", { max: MAX_DATES_PER_PROPOSAL, date: fmt.long(dayOff.windowEnd) })}
      confirmText={t("dayOff.propose.submit")}
      confirmDisabled={!form.valid}
      onConfirm={() => form.valid && onConfirm(form.dates)}
    >
      <div className="flex flex-col gap-2">
        {form.dates.map((date, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              min={min}
              max={dayOff.windowEnd}
              aria-label={t("dayOff.propose.date", { n: index + 1 })}
              onChange={(e) => form.set(index, e.target.value)}
              className={`${inputClass} min-w-0 flex-1`}
            />
            {form.dates.length > 1 && (
              <RowIconButton icon={Trash2} tone="danger" label={t("dayOff.propose.remove")} onClick={() => form.remove(index)} />
            )}
          </div>
        ))}
        {form.canAdd && (
          <Button type="button" size="sm" variant="ghost" className="self-start" onClick={form.add}>
            <Plus className="size-4" />
            {t("dayOff.propose.add")}
          </Button>
        )}
      </div>
    </ConfirmationDialog>
  );
}
