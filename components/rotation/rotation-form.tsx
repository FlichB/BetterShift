"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChoiceChips, Field, inputClass } from "@/components/form-kit";
import { MemberOrderList } from "@/components/rotation/member-order-list";
import { useRotationForm } from "@/components/rotation/use-rotation-form";
import { fetchSuggestedOffset, RotationApiError, useSaveRotation, type RotationCalendar } from "@/hooks/useRotations";
import { handleRateLimitError } from "@/lib/rate-limit-client";
import type { RotationDetail } from "@/lib/rotation/service";
import type { RotationPeriod } from "@/lib/rotation/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function RotationForm({
  calendar,
  rotation,
  onDone,
}: {
  calendar: RotationCalendar;
  rotation?: RotationDetail;
  onDone: () => void;
}) {
  const t = useTranslations();
  const { state, set, toggleWeekday, addSkipDate, updateSkipDate, removeSkipDate, toInput } = useRotationForm(
    calendar,
    rotation
  );
  const save = useSaveRotation();
  const [restartDate, setRestartDate] = useState(state.startDate);

  const showError = (error: unknown) => {
    if (error instanceof RotationApiError) {
      if (error.status === 429) {
        // An empty body makes the helper show its generic rate-limit toast
        void handleRateLimitError(new Response(null, { status: 429 }), t);
      } else {
        toast.error(t(`rotation.errors.${error.code}`));
      }
    } else {
      toast.error(t("rotation.errors.internal"));
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    save.mutate(
      { id: rotation?.id, input: toInput() },
      {
        onSuccess: () => {
          toast.success(t("rotation.saved"));
          onDone();
        },
        onError: showError,
      }
    );
  };

  const applySuggestion = async () => {
    if (!rotation || !restartDate) return;
    try {
      const startOffset = await fetchSuggestedOffset(rotation.id, restartDate, state.memberIds);
      set("startOffset", startOffset);
      set("startDate", restartDate);
    } catch (error) {
      showError(error);
    }
  };

  const periodOptions: { value: RotationPeriod; label: string }[] = [
    { value: "day", label: t("rotation.period.day") },
    { value: "week", label: t("rotation.period.week") },
    { value: "days", label: t("rotation.period.days") },
  ];

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label={t("rotation.fields.name")} htmlFor="rotation-name">
        <Input
          id="rotation-name"
          className={inputClass}
          value={state.name}
          maxLength={100}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>

      <Field label={t("rotation.fields.preset")}>
        <Select value={state.presetId} onValueChange={(v) => set("presetId", v)}>
          <SelectTrigger className={cn(inputClass, "w-full")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {calendar.presets.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title} ({p.startTime}–{p.endTime})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label={t("rotation.fields.perShift")} htmlFor="rotation-per-shift">
        <Input
          id="rotation-per-shift"
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          className={inputClass}
          value={state.perShift}
          onChange={(e) => set("perShift", Number(e.target.value))}
        />
      </Field>

      <Field label={t("rotation.fields.period")}>
        <ChoiceChips value={state.period} onChange={(v) => set("period", v)} options={periodOptions} label={t("rotation.fields.period")} />
      </Field>

      {state.period === "days" && (
        <Field label={t("rotation.fields.periodDays")} htmlFor="rotation-period-days">
          <Input
            id="rotation-period-days"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            className={inputClass}
            value={state.periodDays}
            onChange={(e) => set("periodDays", Number(e.target.value))}
          />
        </Field>
      )}

      <Field label={t("rotation.fields.startDate")} htmlFor="rotation-start-date">
        <Input
          id="rotation-start-date"
          type="date"
          className={inputClass}
          value={state.startDate}
          onChange={(e) => set("startDate", e.target.value)}
        />
      </Field>

      <Field label={t("rotation.fields.weekdays")} hint={state.weekdays.length === 0 ? t("rotation.allDays") : undefined}>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("rotation.fields.weekdays")}>
          {WEEKDAYS.map((day) => {
            const selected = state.weekdays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleWeekday(day)}
                className={cn(
                  "flex h-9 min-w-10 items-center justify-center rounded-lg border px-2.5 text-[13px] font-medium transition-colors",
                  selected
                    ? "border-brand bg-brand-soft font-semibold text-brand-ink"
                    : "border-line bg-surface-card text-fg-body hover:bg-surface-panel"
                )}
              >
                {t(`rotation.weekday.${day}`)}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={t("rotation.fields.skipDates")}>
        <div className="space-y-2">
          {state.skipDates.map((date, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                type="date"
                aria-label={t("rotation.fields.skipDates")}
                className={cn(inputClass, "min-w-0 flex-1")}
                value={date}
                onChange={(e) => updateSkipDate(index, e.target.value)}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={t("rotation.removeMember")} onClick={() => removeSkipDate(index)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addSkipDate}>
            <Plus className="size-3.5" />
            {t("rotation.addSkipDate")}
          </Button>
        </div>
      </Field>

      <Field label={t("rotation.fields.members")}>
        <MemberOrderList members={calendar.members} value={state.memberIds} onChange={(ids) => set("memberIds", ids)} />
      </Field>

      {state.memberIds.length > 0 && (
        <Field label={t("rotation.fields.startOffset")}>
          <Select value={String(state.startOffset)} onValueChange={(v) => set("startOffset", Number(v))}>
            <SelectTrigger className={cn(inputClass, "w-full")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {state.memberIds.map((id, index) => (
                <SelectItem key={id} value={String(index)}>
                  {index + 1}. {calendar.members.find((m) => m.id === id)?.name ?? id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {rotation && (
        <section className="space-y-3 rounded-[11px] border border-line bg-surface-panel p-3.5">
          <div>
            <h3 className="text-[14px] font-semibold text-fg-strong">{t("rotation.restart")}</h3>
            <p className="mt-0.5 text-[12.5px] text-fg-secondary">{t("rotation.restartHint")}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="date"
              aria-label={t("rotation.restart")}
              className={cn(inputClass, "min-w-0 sm:flex-1")}
              value={restartDate}
              onChange={(e) => setRestartDate(e.target.value)}
            />
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={applySuggestion}>
              {t("rotation.suggestOffset")}
            </Button>
          </div>
        </section>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onDone}>
          {t("rotation.cancel")}
        </Button>
        <Button type="submit" className="w-full sm:w-auto" disabled={save.isPending}>
          {t("rotation.save")}
        </Button>
      </div>
    </form>
  );
}
