// [fork] Rebuilds the save payload of a rotation; client-safe (no database imports).
import type { RotationDetail } from "@/lib/rotation/service";
import type { RotationInput } from "@/lib/rotation/validate";

export function inputFromRotation(rotation: RotationDetail): RotationInput {
  return {
    name: rotation.name,
    calendarId: rotation.calendarId,
    presetId: rotation.presetId ?? "",
    memberIds: rotation.memberIds,
    perShift: rotation.perShift,
    period: rotation.period,
    periodDays: rotation.periodDays,
    startDate: rotation.startDate,
    startOffset: rotation.startOffset,
    weekdays: rotation.weekdays,
    skipDates: rotation.skipDates,
    closedTitle: rotation.closedTitle,
    holidayCalendarId: rotation.holidayCalendarId,
    holidayOpenDates: rotation.holidayOpenDates,
    entryTitle: rotation.entryTitle,
    reinforcedDates: rotation.reinforcedDates,
    dayOffEnabled: rotation.dayOffEnabled,
    dayOffTitle: rotation.dayOffTitle,
  };
}
