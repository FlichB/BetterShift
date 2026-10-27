"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BaseSheet } from "@/components/ui/base-sheet";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceChips, Field, inputClass, textareaClass } from "@/components/form-kit";
import { useForceSwap } from "@/hooks/useSwaps";
import { toastSwapError } from "@/components/swap/swap-card";
import { useForceSwapForm } from "@/components/swap/use-force-swap-form";
import type { Audience } from "@/components/swap/use-swap-offer-form";
import { cn } from "@/lib/utils";

export function ForceSheet({
  open,
  onOpenChange,
  calendarId,
  shiftId,
  absent,
  holderIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendarId: string;
  shiftId: string;
  absent: { id: string; name: string };
  holderIds: string[];
}) {
  const t = useTranslations();
  const form = useForceSwapForm(calendarId, shiftId, absent.id, holderIds);
  const force = useForceSwap();
  const [confirming, setConfirming] = useState(false);

  const submit = () => {
    setConfirming(false);
    force.mutate(form.toInput(), {
      onSuccess: () => {
        toast.success(t("swap.done.forced"));
        onOpenChange(false);
      },
      onError: (error) => toastSwapError(error, t),
    });
  };

  return (
    <>
      <BaseSheet
        open={open}
        onOpenChange={onOpenChange}
        title={t("swap.force.title")}
        showSaveButton
        saveLabel={t("swap.force.submit")}
        onSave={() => setConfirming(true)}
        isSaving={force.isPending}
        saveDisabled={!form.canSubmit}
      >
        <div className="flex flex-col gap-4">
          <Field label={t("swap.force.absent")}>
            <p className="text-[14px] text-fg-strong">{absent.name}</p>
          </Field>
          <Field label={t("swap.force.substitute")}>
            <ChoiceChips<Audience>
              value={form.audience}
              onChange={form.setAudience}
              label={t("swap.force.substitute")}
              options={[
                { value: "person", label: t("swap.force.person") },
                { value: "everyone", label: t("swap.force.everyone") },
              ]}
            />
          </Field>
          {form.audience === "person" && (
            <Field label={t("swap.force.target")} htmlFor="force-target">
              <Select value={form.targetUserId} onValueChange={form.setTargetUserId}>
                <SelectTrigger id="force-target" className={cn(inputClass, "w-full")}>
                  <SelectValue placeholder={t("swap.form.targetPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {form.targets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name ?? p.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t("swap.form.note")} htmlFor="force-note" optional>
            <Textarea
              id="force-note"
              value={form.note}
              maxLength={200}
              rows={2}
              placeholder={t("swap.force.notePlaceholder")}
              onChange={(e) => form.setNote(e.target.value)}
              className={textareaClass}
            />
          </Field>
        </div>
      </BaseSheet>
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("swap.force.confirmTitle")}
        description={
          form.audience === "person"
            ? t("swap.force.confirmPerson", { absent: absent.name, name: form.targetName })
            : t("swap.force.confirmEveryone", { absent: absent.name })
        }
        confirmText={t("swap.force.submit")}
        onConfirm={submit}
      />
    </>
  );
}
