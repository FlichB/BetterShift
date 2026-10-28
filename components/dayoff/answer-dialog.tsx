"use client";

// [fork] Declines a Dienstfrei proposal; managers must give a reason, the holder may.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, textareaClass } from "@/components/form-kit";
import type { DayOffProposalView } from "@/lib/dayoff/types";
import type { DayOffCardMode } from "@/components/dayoff/day-off-card";
import { useDayOffFormat } from "@/components/dayoff/use-day-off-format";

export function AnswerDialog({
  proposal,
  mode,
  onCancel,
  onConfirm,
}: {
  proposal: DayOffProposalView;
  mode: DayOffCardMode;
  onCancel: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const t = useTranslations();
  const fmt = useDayOffFormat();
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const required = mode === "manage";

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t("dayOff.decline.title")}
      description={t("dayOff.decline.text", { date: fmt.long(proposal.date) })}
      confirmText={t("dayOff.actions.decline")}
      confirmVariant="destructive"
      confirmDisabled={required && trimmed.length === 0}
      onConfirm={() => onConfirm(trimmed || null)}
    >
      <Field label={t("dayOff.reason")} htmlFor="day-off-decline-reason" optional={!required}>
        <Textarea
          id="day-off-decline-reason"
          value={reason}
          maxLength={500}
          rows={2}
          onChange={(e) => setReason(e.target.value)}
          className={textareaClass}
        />
      </Field>
    </ConfirmationDialog>
  );
}
