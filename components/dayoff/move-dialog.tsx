"use client";

// [fork] Moves a Dienstfrei to another workday of its week; the server lists the allowed days.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ChoiceChips } from "@/components/form-kit";
import { useDayOffOptions } from "@/hooks/useDayOffs";
import type { DayOffView } from "@/lib/dayoff/types";
import { useDayOffFormat } from "@/components/dayoff/use-day-off-format";

export function MoveDialog({
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
  const query = useDayOffOptions(dayOff.id);
  const options = query.data?.options ?? [];
  const current = options.find((o) => o.isCurrent)?.date ?? dayOff.date ?? undefined;
  const [picked, setPicked] = useState<string>();
  const value = picked ?? current;

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t("dayOff.move.title")}
      description={t("dayOff.move.text")}
      confirmText={t("dayOff.actions.move")}
      confirmDisabled={!value || value === current}
      onConfirm={() => value && onConfirm(value)}
    >
      {query.isLoading && <p className="text-[13px] text-fg-secondary">{t("common.loading")}</p>}
      {query.isError && <p className="text-[13px] text-fg-secondary">{t("dayOff.move.loadFailed")}</p>}
      {!query.isLoading && !query.isError && options.length === 0 && (
        <p className="text-[13px] text-fg-secondary">{t("dayOff.move.none")}</p>
      )}
      {options.length > 0 && (
        <ChoiceChips<string>
          value={value}
          onChange={setPicked}
          label={t("dayOff.move.title")}
          options={options.map((o) => ({
            value: o.date,
            disabled: o.full,
            label: (
              <>
                <span>{fmt.short(o.date)}</span>
                <span className="font-normal text-fg-secondary">
                  {o.full ? t("dayOff.move.full") : t("dayOff.othersOff", { count: o.othersOff })}
                </span>
              </>
            ),
          }))}
        />
      )}
    </ConfirmationDialog>
  );
}
