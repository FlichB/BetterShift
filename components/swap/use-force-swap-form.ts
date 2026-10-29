"use client";

import { useMemo, useState } from "react";
import { useSwapDuties, type ForceSwapInput } from "@/hooks/useSwaps";
import type { Audience } from "@/components/swap/use-swap-offer-form";

/** Form state for forcing a swap of one Platz (spec D4): a named Einspringer or offen an alle. */
export function useForceSwapForm(calendarId: string, shiftId: string, absentUserId: string, holderIds: string[]) {
  const [audience, setAudience] = useState<Audience>("person");
  const [targetUserId, setTargetUserId] = useState("");
  const [note, setNote] = useState("");
  const duties = useSwapDuties(calendarId);

  const targets = useMemo(
    () => (duties.data?.members ?? []).filter((p) => !holderIds.includes(p.id)),
    [duties.data?.members, holderIds]
  );
  const canSubmit = (audience === "everyone" || targets.some((p) => p.id === targetUserId)) && note.length <= 200;
  const targetName = targets.find((p) => p.id === targetUserId)?.name ?? "?";
  const dayOffStays = duties.data?.duties.find((d) => d.shiftId === shiftId)?.dayOffStays ?? false; // [fork] SPEC 12.42

  const toInput = (): ForceSwapInput => ({
    shiftId,
    absentUserId,
    substituteUserId: audience === "person" ? targetUserId : null,
    note: note.trim() || null,
  });

  return {
    audience, setAudience,
    targetUserId, setTargetUserId, targetName,
    note, setNote,
    targets, dayOffStays,
    loading: duties.isLoading,
    canSubmit, toInput,
  };
}
