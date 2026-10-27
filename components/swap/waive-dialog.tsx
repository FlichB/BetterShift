"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, textareaClass } from "@/components/form-kit";
import { useDutyFormat } from "@/components/swap/use-duty-format";
import type { BoardEntry } from "@/lib/swap/types";

/** Releases the Einspringer from the Ausgleich; a reason is required (spec D8). */
export function WaiveDialog({
  entry,
  onCancel,
  onConfirm,
}: {
  entry: BoardEntry;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations();
  const fmt = useDutyFormat();
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t("swap.counter.waiveTitle")}
      description={t("swap.counter.waiveText", { name: entry.acceptedBy?.name ?? "?", date: fmt(entry.offered).date })}
      confirmText={t("swap.counter.waive")}
      confirmDisabled={trimmed.length === 0}
      onConfirm={() => onConfirm(trimmed)}
    >
      <Field label={t("swap.counter.reason")} htmlFor="waive-reason">
        <Textarea
          id="waive-reason"
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
