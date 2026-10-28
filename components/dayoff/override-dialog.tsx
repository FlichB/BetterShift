"use client";

// [fork] Asks a rotation manager to give a full day anyway (SPEC 12.44).
import { useTranslations } from "next-intl";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { StaffingDetail } from "@/lib/dayoff/types";
import { useDayOffFormat } from "@/components/dayoff/use-day-off-format";

export function OverrideDialog({ detail, onCancel, onConfirm }: { detail: StaffingDetail; onCancel: () => void; onConfirm: () => void }) {
  const t = useTranslations();
  const fmt = useDayOffFormat();
  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t("dayOff.override.title")}
      description={t("dayOff.override.text", { date: fmt.long(detail.date), present: detail.present, minimum: detail.minimum })}
      confirmText={t("dayOff.override.confirm")}
      onConfirm={onConfirm}
    />
  );
}
