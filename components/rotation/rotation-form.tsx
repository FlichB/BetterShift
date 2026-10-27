"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChoiceChips, Field, inputClass } from "@/components/form-kit";
import { EntryTitleField } from "@/components/rotation/entry-title-field";
import { MemberOrderList } from "@/components/rotation/member-order-list";
import { useRotationForm } from "@/components/rotation/use-rotation-form";
import { fetchSuggestedOffset, RotationApiError, useSaveRotation, type RotationCalendar } from "@/hooks/useRotations";
import { useCalendars } from "@/hooks/useCalendars";
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
  const {
    state,
    set,
    toggleWeekday,
    addSkipDate,
    updateSkipDate,
    removeSkipDate,
    addReinforcedDate,
    updateReinforcedDate,
    removeReinforcedDate,
    removeOpenDate,
    toInput,
  } =
    useRotationForm(calendar, rotation, { closedTitle: t("rotation.fields.closedTitleDefault") });
  const { calendars } = useCalendars();
  const save = useSaveRotation();
  const firstMember = calendar.members.find((m) => m.id === state.memberIds[0]);
  const previewHolder = firstMember ? { name: firstMember.name, email: null } : null;
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
          {state.skipDates.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                <Input
                  type="date"
                  aria-label={t("rotation.fields.skipDates")}
                  className={cn(inputClass, "min-w-0 flex-1")}
                  value={entry.date}
                  onChange={(e) => updateSkipDate(index, { date: e.target.value })}
                />
                <Input
                  aria-label={t("rotation.fields.skipReason")}
                  placeholder={t("rotation.fields.skipReason")}
                  className={cn(inputClass, "min-w-0 flex-1")}
                  maxLength={100}
                  value={entry.reason}
                  onChange={(e) => updateSkipDate(index, { reason: e.target.value })}
                />
              </div>
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

      <Field label={t("rotation.fields.reinforcedDates")} hint={t("rotation.fields.reinforcedHint")}>
        <div className="space-y-2">
          {state.reinforcedDates.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                <Input
                  type="date"
                  aria-label={t("rotation.fields.reinforcedDates")}
                  className={cn(inputClass, "min-w-0 flex-1")}
                  value={entry.date}
                  onChange={(e) => updateReinforcedDate(index, { date: e.target.value })}
                />
                <Input
                  type="number"
                  min={state.perShift + 1}
                  max={state.memberIds.length}
                  aria-label={t("rotation.fields.reinforcedPeople")}
                  placeholder={t("rotation.fields.reinforcedPeople")}
                  className={cn(inputClass, "min-w-0 sm:w-40")}
                  value={entry.perShift}
                  onChange={(e) => updateReinforcedDate(index, { perShift: Number(e.target.value) })}
                />
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={t("rotation.removeMember")} onClick={() => removeReinforcedDate(index)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addReinforcedDate}>
            <Plus className="size-3.5" />
            {t("rotation.addReinforcedDate")}
          </Button>
        </div>
      </Field>

      <EntryTitleField
        value={state.entryTitle}
        onChange={(value) => set("entryTitle", value)}
        previewHolder={previewHolder}
        dutyTitle={calendar.presets.find((p) => p.id === state.presetId)?.title ?? ""}
      />

      <Field label={t("rotation.fields.closedTitle")} hint={t("rotation.fields.closedTitleHint")}>
        <Input className={inputClass} maxLength={100} value={state.closedTitle} onChange={(e) => set("closedTitle", e.target.value)} />
      </Field>

      <Field label={t("rotation.fields.holidayCalendar")} hint={t("rotation.fields.holidayCalendarHint")}>
        <Select value={state.holidayCalendarId ?? "none"} onValueChange={(v) => set("holidayCalendarId", v === "none" ? null : v)}>
          <SelectTrigger className={cn(inputClass, "w-full")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("rotation.fields.holidayCalendarNone")}</SelectItem>
            {calendars
              .filter((c) => c.id !== calendar.id)
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            {state.holidayCalendarId && !calendars.some((c) => c.id === state.holidayCalendarId) && (
              // Chosen by another Verantwortlicher; this user cannot see it but may keep it.
              <SelectItem value={state.holidayCalendarId}>{t("rotation.fields.holidayCalendarUnavailable")}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>

      {state.holidayOpenDates.length > 0 && (
        <Field label={t("rotation.fields.holidayOpenDates")}>
          <ul className="space-y-1">
            {state.holidayOpenDates.map((date) => (
              <li key={date} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{date}</span>
                <Button type="button" variant="ghost" size="icon" aria-label={t("rotation.removeMember")} onClick={() => removeOpenDate(date)}>
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </Field>
      )}

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
