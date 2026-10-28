"use client";

// [fork] Sheet to request, enter or change an Urlaub. The parent decides what saving does
// (a direct request, or the replan preview first for actions that change approved vacations).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { BaseSheet } from "@/components/ui/base-sheet";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, inputClass, textareaClass } from "@/components/form-kit";
import { MAX_NOTE_LENGTH, type VacationView } from "@/lib/vacation/types";
import { cn } from "@/lib/utils";
import { todayLocal, tomorrowLocal } from "@/components/vacation/use-vacation-format";

/** request: own new vacation · enter: Verwaltung for a person · change: Verwaltung edits · requestChange: person asks to change. */
export type RequestSheetMode = "request" | "enter" | "change" | "requestChange";

export interface RequestSheetValues {
  userId: string | null;
  startDate: string;
  endDate: string;
  note: string | null;
}

function useVacationForm(mode: RequestSheetMode, vacation: VacationView | undefined) {
  const today = todayLocal();
  const tomorrow = tomorrowLocal();
  const [userId, setUserId] = useState("");
  const [startDate, setStartDate] = useState(vacation?.startDate ?? "");
  const [endDate, setEndDate] = useState(vacation?.endDate ?? "");
  const [note, setNote] = useState("");
  // Begun days are immutable: a running vacation keeps its start and ends today at the earliest.
  const running = Boolean(vacation && vacation.startDate <= today);
  const startMin = tomorrow;
  const endMin = running ? today : startDate && startDate > tomorrow ? startDate : tomorrow;
  const changed = !vacation || startDate !== vacation.startDate || endDate !== vacation.endDate;
  const valid =
    Boolean(startDate && endDate) &&
    endDate >= startDate &&
    endDate >= endMin &&
    (running || startDate >= startMin) &&
    (mode !== "enter" || Boolean(userId)) &&
    changed;
  return {
    userId,
    setUserId,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    note,
    setNote,
    running,
    startMin,
    endMin,
    valid,
    dirty: (changed && Boolean(startDate || endDate)) || note.trim() !== "" || userId !== "",
    values: (): RequestSheetValues => ({ userId: userId || null, startDate, endDate, note: note.trim() || null }),
  };
}

export function RequestSheet({
  open,
  onOpenChange,
  mode,
  vacation,
  people,
  isSaving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RequestSheetMode;
  vacation?: VacationView;
  people: { id: string; name: string }[];
  isSaving: boolean;
  onSubmit: (values: RequestSheetValues) => void;
}) {
  const t = useTranslations();
  const form = useVacationForm(mode, vacation);
  const title =
    mode === "request"
      ? t("vacation.request")
      : mode === "enter"
        ? t("vacation.enter")
        : mode === "change"
          ? t("vacation.actions.edit")
          : t("vacation.actions.requestChange");

  return (
    <BaseSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={vacation && mode === "change" ? vacation.user.name : undefined}
      showSaveButton
      saveLabel={title}
      onSave={() => onSubmit(form.values())}
      isSaving={isSaving}
      saveDisabled={!form.valid}
      hasUnsavedChanges={form.dirty}
    >
      <div className="flex flex-col gap-4">
        {mode === "enter" && (
          <Field label={t("vacation.person")} htmlFor="vacation-person">
            <Select value={form.userId} onValueChange={form.setUserId}>
              <SelectTrigger id="vacation-person" className={cn(inputClass, "w-full")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("vacation.from")} htmlFor="vacation-from">
            <Input
              id="vacation-from"
              type="date"
              value={form.startDate}
              min={form.running ? undefined : form.startMin}
              disabled={form.running}
              onChange={(e) => form.setStartDate(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t("vacation.to")} htmlFor="vacation-to">
            <Input
              id="vacation-to"
              type="date"
              value={form.endDate}
              min={form.endMin}
              onChange={(e) => form.setEndDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        {mode !== "change" && (
          <Field label={t("vacation.note")} htmlFor="vacation-note" optional>
            <Textarea
              id="vacation-note"
              value={form.note}
              maxLength={MAX_NOTE_LENGTH}
              rows={2}
              onChange={(e) => form.setNote(e.target.value)}
              className={textareaClass}
            />
          </Field>
        )}
      </div>
    </BaseSheet>
  );
}
