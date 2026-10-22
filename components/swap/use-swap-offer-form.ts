"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSwapDuties, type CreateSwapInput } from "@/hooks/useSwaps";
import type { SwapType } from "@/lib/swap/types";

export type Audience = "everyone" | "person";
export const ANY_DUTY = "any";

export function useSwapOfferForm(calendarIds: string[], initial?: { calendarId?: string; shiftId?: string }) {
  const { user } = useAuth();
  const [calendarId, setCalendarId] = useState(
    initial?.calendarId && calendarIds.includes(initial.calendarId) ? initial.calendarId : calendarIds[0]
  );
  const [shiftId, setShiftId] = useState(initial?.shiftId ?? "");
  const [type, setType] = useState<SwapType>("give");
  const [audience, setAudience] = useState<Audience>("everyone");
  const [targetUserId, setTargetUserId] = useState("");
  const [requestedShiftId, setRequestedShiftId] = useState(ANY_DUTY);
  const [note, setNote] = useState("");
  const duties = useSwapDuties(calendarId);

  const all = useMemo(() => duties.data?.duties ?? [], [duties.data]);
  const mySlots = useMemo(
    () => all.filter((d) => d.holders.some((h) => h.id === user?.id) && !d.myOpenSwapId),
    [all, user?.id]
  );
  const counterDuties = useMemo(
    () => all.filter((d) => d.shiftId !== shiftId && !d.holders.some((h) => h.id === user?.id)),
    [all, shiftId, user?.id]
  );
  const concrete = type === "exchange" && requestedShiftId !== ANY_DUTY;
  // A Direktanfrage for a concrete counter duty can only go to someone holding it.
  const targets = useMemo(() => {
    const pool = concrete
      ? (all.find((d) => d.shiftId === requestedShiftId)?.holders ?? [])
      : (duties.data?.members ?? []);
    return pool.filter((p) => p.id !== user?.id);
  }, [concrete, all, requestedShiftId, duties.data?.members, user?.id]);

  const selectedShiftValid = mySlots.some((d) => d.shiftId === shiftId);
  const targetValid = audience === "everyone" || targets.some((p) => p.id === targetUserId);
  const canSubmit = selectedShiftValid && targetValid && note.length <= 200;

  const changeCalendar = (id: string) => {
    setCalendarId(id);
    setShiftId("");
    setRequestedShiftId(ANY_DUTY);
    setTargetUserId("");
  };
  const changeType = (next: SwapType) => {
    setType(next);
    setRequestedShiftId(ANY_DUTY);
  };
  const changeRequested = (id: string) => {
    setRequestedShiftId(id);
    setTargetUserId("");
  };

  const toInput = (): CreateSwapInput => ({
    shiftId,
    type,
    targetUserId: audience === "person" ? targetUserId : null,
    requestedShiftId: concrete ? requestedShiftId : null,
    note: note.trim() || null,
  });

  return {
    calendarId, changeCalendar,
    shiftId, setShiftId,
    type, changeType,
    audience, setAudience,
    targetUserId, setTargetUserId,
    requestedShiftId, changeRequested,
    note, setNote,
    mySlots, counterDuties, targets,
    loading: duties.isLoading,
    canSubmit, toInput,
  };
}
