"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BaseSheet } from "@/components/ui/base-sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceChips, Field, InfoNote, inputClass, textareaClass } from "@/components/form-kit";
import { useCreateSwap } from "@/hooks/useSwaps";
import { toastSwapError } from "@/components/swap/swap-card";
import { useDutyFormat } from "@/components/swap/use-duty-format";
import { ANY_DUTY, useSwapOfferForm, type Audience } from "@/components/swap/use-swap-offer-form";
import { CalendarX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DutyInfo } from "@/lib/swap/types";

export function OfferSheet({
  open,
  onOpenChange,
  calendars,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendars: { id: string; name: string }[];
  initial?: { calendarId?: string; shiftId?: string };
}) {
  const t = useTranslations();
  const fmt = useDutyFormat();
  const form = useSwapOfferForm(calendars.map((c) => c.id), initial);
  const create = useCreateSwap();

  const submit = () =>
    create.mutate(form.toInput(), {
      onSuccess: () => {
        toast.success(t("swap.done.offered"));
        onOpenChange(false);
      },
      onError: (error) => toastSwapError(error, t),
    });

  const label = (d: DutyInfo) => {
    const f = fmt(d);
    return `${f.date} · ${f.time}`;
  };

  return (
    <BaseSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("swap.offer")}
      showSaveButton
      saveLabel={t("swap.form.submit")}
      onSave={submit}
      isSaving={create.isPending}
      saveDisabled={!form.canSubmit}
    >
      <div className="flex flex-col gap-4">
        {calendars.length > 1 && (
          <Field label={t("swap.calendar")} htmlFor="swap-calendar">
            <Select value={form.calendarId} onValueChange={form.changeCalendar}>
              <SelectTrigger id="swap-calendar" className={cn(inputClass, "w-full")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        {!form.loading && form.mySlots.length === 0 ? (
          <InfoNote icon={CalendarX}>{t("swap.form.noSlots")}</InfoNote>
        ) : (
          <>
            <Field label={t("swap.form.shift")} htmlFor="swap-shift">
              <Select value={form.shiftId} onValueChange={form.setShiftId}>
                <SelectTrigger id="swap-shift" className={cn(inputClass, "w-full")}>
                  <SelectValue placeholder={t("swap.form.shiftPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {form.mySlots.map((d) => (
                    <SelectItem key={d.shiftId} value={d.shiftId}>
                      {label(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {form.mySlots.find((d) => d.shiftId === form.shiftId)?.dayOffStays && (
              <p className="text-xs text-fg-tertiary">{t("swap.dayOffStays")}</p>
            )}

            <Field label={t("swap.form.requested")} htmlFor="swap-requested">
              <Select value={form.requestedShiftId} onValueChange={form.changeRequested}>
                <SelectTrigger id="swap-requested" className={cn(inputClass, "w-full")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_DUTY}>{t("swap.form.anyDuty")}</SelectItem>
                  {form.counterDuties.map((d) => (
                    <SelectItem key={d.shiftId} value={d.shiftId}>
                      {label(d)} · {d.holders.map((h) => h.name ?? "?").join(", ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label={t("swap.form.audience")}>
              <ChoiceChips<Audience>
                value={form.audience}
                onChange={form.setAudience}
                label={t("swap.form.audience")}
                options={[
                  { value: "everyone", label: t("swap.form.everyone") },
                  { value: "person", label: t("swap.form.person") },
                ]}
              />
            </Field>

            {form.audience === "person" && (
              <Field label={t("swap.form.target")} htmlFor="swap-target">
                <Select value={form.targetUserId} onValueChange={form.setTargetUserId}>
                  <SelectTrigger id="swap-target" className={cn(inputClass, "w-full")}>
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

            <Field label={t("swap.form.note")} htmlFor="swap-note" optional>
              <Textarea
                id="swap-note"
                value={form.note}
                maxLength={200}
                rows={2}
                placeholder={t("swap.form.notePlaceholder")}
                onChange={(e) => form.setNote(e.target.value)}
                className={textareaClass}
              />
            </Field>
          </>
        )}
      </div>
    </BaseSheet>
  );
}
