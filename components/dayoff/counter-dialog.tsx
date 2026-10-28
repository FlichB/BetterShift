"use client";

// [fork] A rotation manager counter-proposes one date for a locked or agreed Dienstfrei.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Field, inputClass } from "@/components/form-kit";
import type { DayOffView } from "@/lib/dayoff/types";
import { tomorrowLocal, useDayOffFormat } from "@/components/dayoff/use-day-off-format";

export function DayOffCounterDialog({
  dayOff,
  onCancel,
  onConfirm,
}: {
  dayOff: DayOffView;
  onCancel: () => void;
  onConfirm: (date: string) => void;
}) {
  const t = useTranslations();
  const fmt = useDayOffFormat();
  const min = tomorrowLocal();
  const [date, setDate] = useState("");
  const valid = Boolean(date) && date >= min && date <= dayOff.windowEnd;

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t("dayOff.actions.counter")}
      description={t("dayOff.counter.text", { name: dayOff.holder.name, date: fmt.long(dayOff.windowEnd) })}
      confirmText={t("dayOff.counter.submit")}
      confirmDisabled={!valid}
      onConfirm={() => valid && onConfirm(date)}
    >
      <Field label={t("dayOff.counter.date")} htmlFor="day-off-counter-date">
        <Input
          id="day-off-counter-date"
          type="date"
          value={date}
          min={min}
          max={dayOff.windowEnd}
          onChange={(e) => setDate(e.target.value)}
          className={inputClass}
        />
      </Field>
    </ConfirmationDialog>
  );
}
