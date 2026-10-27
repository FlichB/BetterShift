"use client";

// [fork] A rotation manager locks a Dienstfrei: it loses its date and the holder proposes new ones.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, textareaClass } from "@/components/form-kit";
import type { DayOffView } from "@/lib/dayoff/types";

export function LockDialog({
  dayOff,
  onCancel,
  onConfirm,
}: {
  dayOff: DayOffView;
  onCancel: () => void;
  onConfirm: (note: string | null) => void;
}) {
  const t = useTranslations();
  const [note, setNote] = useState("");

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t("dayOff.lock.title")}
      description={t("dayOff.lockConfirm", { name: dayOff.holder.name })}
      confirmText={t("dayOff.actions.lock")}
      confirmVariant="destructive"
      onConfirm={() => onConfirm(note.trim() || null)}
    >
      <Field label={t("dayOff.note")} htmlFor="day-off-lock-note" optional>
        <Textarea
          id="day-off-lock-note"
          value={note}
          maxLength={500}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          className={textareaClass}
        />
      </Field>
    </ConfirmationDialog>
  );
}
