"use client";

// [fork] Asks for a reason: required to decline a request, optional when asking to cancel a vacation.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, textareaClass } from "@/components/form-kit";
import { MAX_NOTE_LENGTH } from "@/lib/vacation/types";

export function ReasonDialog({
  title,
  description,
  confirmText,
  required,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmText: string;
  required: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const t = useTranslations();
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={title}
      description={description}
      confirmText={confirmText}
      confirmVariant="destructive"
      confirmDisabled={required && !trimmed}
      onConfirm={() => onConfirm(trimmed || null)}
    >
      <Field label={required ? t("vacation.reason") : t("vacation.note")} htmlFor="vacation-reason" optional={!required}>
        <Textarea
          id="vacation-reason"
          value={reason}
          maxLength={MAX_NOTE_LENGTH}
          rows={2}
          onChange={(e) => setReason(e.target.value)}
          className={textareaClass}
        />
      </Field>
    </ConfirmationDialog>
  );
}
