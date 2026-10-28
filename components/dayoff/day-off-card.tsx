"use client";

// [fork] One Dienstfrei on the swap board, with the actions its mode and status allow.
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, CalendarPlus, Check, Lock, MessageSquareReply, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/form-kit";
import { SwapApiError } from "@/hooks/useSwaps";
import { dayOffErrorMessage } from "@/lib/dayoff/error-message";
import type { DayOffErrorCode, DayOffProposalView, DayOffStatus, DayOffView, ProposalStatus } from "@/lib/dayoff/types";
import { handleRateLimitError } from "@/lib/rate-limit-client";
import { useDayOffFormat } from "@/components/dayoff/use-day-off-format";

type T = ReturnType<typeof useTranslations>;

export function toastDayOffError(error: unknown, t: T): void {
  if (error instanceof SwapApiError && error.status === 429) {
    const body = JSON.stringify({ retryAfter: error.retryAfter ?? undefined });
    void handleRateLimitError(new Response(body, { status: 429 }), t);
  } else if (error instanceof SwapApiError && t.has(`dayOff.errors.${error.code}`)) {
    toast.error(dayOffErrorMessage(t, error.code as DayOffErrorCode));
  } else {
    toast.error(t("swap.errors.internal"));
  }
}

const STATUS_TONE: Record<DayOffStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  standard: "neutral",
  moved: "brand",
  locked: "warning",
  agreed: "success",
  dropped: "danger",
};

const PROPOSAL_TONE: Record<ProposalStatus, "neutral" | "brand" | "success" | "danger"> = {
  open: "brand",
  accepted: "success",
  declined: "danger",
  void: "neutral",
};

export type DayOffCardMode = "mine" | "manage";
export type DayOffCardAction =
  | { kind: "move" | "propose" | "lock" | "counter" }
  | { kind: "accept" | "decline"; proposal: DayOffProposalView };

/** Managers answer the holder's proposals, the holder answers the managers' counter-proposals. */
const answerableSide = (mode: DayOffCardMode) => (mode === "mine" ? "manager" : "holder");

export function DayOffCard({
  dayOff,
  mode,
  busy,
  onAction,
}: {
  dayOff: DayOffView;
  mode: DayOffCardMode;
  busy: boolean;
  onAction: (action: DayOffCardAction) => void;
}) {
  const t = useTranslations();
  const fmt = useDayOffFormat();
  const { status } = dayOff;
  const proposals = [...dayOff.proposals].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const canMove = mode === "mine" && (status === "standard" || status === "moved") && dayOff.canMove;
  const canLock = mode === "manage" && (status === "standard" || status === "moved" || status === "agreed");
  const canCounter = mode === "manage" && (status === "locked" || status === "agreed");

  return (
    <article className="flex flex-col gap-2.5 rounded-[11px] border border-line bg-surface-card px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-fg-strong">
            {t("dayOff.cardTitle", { date: fmt.long(dayOff.dutyDate) })}
          </div>
          <div className="truncate text-[13px] text-fg-secondary">
            {mode === "manage" && `${dayOff.holder.name} · `}
            {dayOff.dutyTitle} · {dayOff.calendarName}
          </div>
        </div>
        <Pill tone={STATUS_TONE[status]}>{t(`dayOff.status.${status}`)}</Pill>
      </div>

      {status !== "dropped" && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg-body">
          <CalendarClock className="size-3.5 text-fg-tertiary" aria-hidden="true" />
          <span className="font-medium">{dayOff.date ? fmt.long(dayOff.date) : t("dayOff.open")}</span>
          {status === "locked" && (
            <>
              <span className="text-fg-tertiary">·</span>
              <span>{t("dayOff.windowEnd", { date: fmt.long(dayOff.windowEnd) })}</span>
            </>
          )}
        </div>
      )}

      {dayOff.lockNote && <p className="text-[13px] italic text-fg-secondary">„{dayOff.lockNote}“</p>}

      {proposals.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {proposals.map((p) => (
            <li key={p.id} className="flex flex-col gap-1.5 rounded-[9px] bg-surface-panel px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-[13px]">
                  <div className="font-medium text-fg-strong">{fmt.long(p.date)}</div>
                  <div className="text-fg-secondary">
                    {p.side === "holder"
                      ? t("dayOff.proposalFrom.holder", { name: dayOff.holder.name })
                      : t("dayOff.proposalFrom.manager")}
                  </div>
                </div>
                <Pill tone={PROPOSAL_TONE[p.status]}>{t(`dayOff.proposalStatus.${p.status}`)}</Pill>
              </div>
              {p.status === "declined" && p.declineReason && (
                <p className="text-[13px] italic text-fg-secondary">„{p.declineReason}“</p>
              )}
              {p.status === "open" && p.side === answerableSide(mode) && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => onAction({ kind: "accept", proposal: p })}>
                    <Check className="size-4" />
                    {t("dayOff.actions.accept")}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction({ kind: "decline", proposal: p })}>
                    <X className="size-4" />
                    {t("dayOff.actions.decline")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(canMove || canLock || canCounter || (mode === "mine" && (status === "locked" || status === "agreed"))) && (
        <div className="flex flex-wrap gap-2">
          {canMove && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction({ kind: "move" })}>
              <CalendarClock className="size-4" />
              {t("dayOff.actions.move")}
            </Button>
          )}
          {mode === "mine" && status === "locked" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction({ kind: "propose" })}>
              <CalendarPlus className="size-4" />
              {t("dayOff.actions.propose")}
            </Button>
          )}
          {mode === "mine" && status === "agreed" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction({ kind: "propose" })}>
              <CalendarPlus className="size-4" />
              {t("dayOff.actions.changeRequest")}
            </Button>
          )}
          {canLock && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction({ kind: "lock" })}>
              <Lock className="size-4" />
              {t("dayOff.actions.lock")}
            </Button>
          )}
          {canCounter && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction({ kind: "counter" })}>
              <MessageSquareReply className="size-4" />
              {t("dayOff.actions.counter")}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
