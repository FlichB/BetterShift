"use client";

import { useState } from "react";
import type { RotationDetail } from "@/lib/rotation/service";
import type { ReinforcedDate, RotationPeriod, SkipDate } from "@/lib/rotation/types";
import type { RotationInput } from "@/lib/rotation/validate";
import type { RotationCalendar } from "@/hooks/useRotations";
import { ENTRY_TITLE_DEFAULT } from "@/lib/rotation/entry-title";
import { formatDateToLocal } from "@/lib/date-utils";

export interface RotationFormState {
  name: string;
  presetId: string;
  perShift: number;
  period: RotationPeriod;
  periodDays: number;
  startDate: string;
  startOffset: number;
  weekdays: number[];
  skipDates: SkipDate[];
  closedTitle: string;
  holidayCalendarId: string | null;
  holidayOpenDates: string[];
  entryTitle: string;
  reinforcedDates: ReinforcedDate[];
  memberIds: string[];
}

function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return formatDateToLocal(d);
}

export function useRotationForm(calendar: RotationCalendar, rotation: RotationDetail | undefined, defaults: { closedTitle: string }) {
  const [state, setState] = useState<RotationFormState>(() =>
    rotation
      ? {
          name: rotation.name,
          presetId: rotation.presetId ?? "",
          perShift: rotation.perShift,
          period: rotation.period,
          periodDays: rotation.periodDays ?? 7,
          startDate: rotation.startDate,
          startOffset: rotation.startOffset,
          weekdays: rotation.weekdays,
          skipDates: rotation.skipDates,
          closedTitle: rotation.closedTitle,
          holidayCalendarId: rotation.holidayCalendarId,
          holidayOpenDates: rotation.holidayOpenDates,
          entryTitle: rotation.entryTitle,
          reinforcedDates: rotation.reinforcedDates,
          memberIds: rotation.memberIds,
        }
      : {
          name: "",
          presetId: calendar.presets[0]?.id ?? "",
          perShift: 2,
          period: "week",
          periodDays: 7,
          startDate: nextMonday(),
          startOffset: 0,
          weekdays: [6],
          skipDates: [],
          closedTitle: defaults.closedTitle,
          holidayCalendarId: null,
          holidayOpenDates: [],
          entryTitle: ENTRY_TITLE_DEFAULT,
          reinforcedDates: [],
          memberIds: [],
        }
  );

  const set = <K extends keyof RotationFormState>(key: K, value: RotationFormState[K]) =>
    setState((s) => ({
      ...s,
      [key]: value,
      // keep startOffset pointing at an existing Teilnehmer
      ...(key === "memberIds" && s.startOffset >= (value as string[]).length ? { startOffset: 0 } : {}),
    }));

  const toggleWeekday = (day: number) =>
    set(
      "weekdays",
      state.weekdays.includes(day)
        ? state.weekdays.filter((d) => d !== day)
        : [...state.weekdays, day].sort((a, b) => a - b)
    );

  const addSkipDate = () => set("skipDates", [...state.skipDates, { date: state.startDate, reason: "" }]);
  const updateSkipDate = (index: number, patch: Partial<SkipDate>) =>
    set(
      "skipDates",
      state.skipDates.map((d, i) => (i === index ? { ...d, ...patch } : d))
    );
  const removeOpenDate = (date: string) =>
    set(
      "holidayOpenDates",
      state.holidayOpenDates.filter((d) => d !== date)
    );
  const removeSkipDate = (index: number) =>
    set(
      "skipDates",
      state.skipDates.filter((_, i) => i !== index)
    );

  const addReinforcedDate = () =>
    set("reinforcedDates", [...state.reinforcedDates, { date: state.startDate, perShift: state.perShift + 1 }]);
  const updateReinforcedDate = (index: number, patch: Partial<ReinforcedDate>) =>
    set(
      "reinforcedDates",
      state.reinforcedDates.map((d, i) => (i === index ? { ...d, ...patch } : d))
    );
  const removeReinforcedDate = (index: number) =>
    set(
      "reinforcedDates",
      state.reinforcedDates.filter((_, i) => i !== index)
    );

  const toInput =(): RotationInput => ({
    name: state.name,
    calendarId: calendar.id,
    presetId: state.presetId,
    memberIds: state.memberIds,
    perShift: state.perShift,
    period: state.period,
    periodDays: state.period === "days" ? state.periodDays : null,
    startDate: state.startDate,
    startOffset: state.startOffset,
    weekdays: state.weekdays,
    skipDates: state.skipDates,
    closedTitle: state.closedTitle,
    holidayCalendarId: state.holidayCalendarId,
    holidayOpenDates: state.holidayOpenDates,
    entryTitle: state.entryTitle,
    reinforcedDates: state.reinforcedDates,
  });

  return {
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
  };
}
