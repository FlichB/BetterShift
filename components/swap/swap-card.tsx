"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeftRight, Ban, EyeOff, Eye, Repeat, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/form-kit";
import { SwapApiError } from "@/hooks/useSwaps";
import { handleRateLimitError } from "@/lib/rate-limit-client";
import type { BoardEntry, SwapStatus } from "@/lib/swap/types";
import { useDutyFormat, useLocalDateFormat } from "@/components/swap/use-duty-format";

type T = ReturnType<typeof useTranslations>;

export function toastSwapError(error: unknown, t: T): void {
  if (error instanceof SwapApiError && error.status === 429) {
    const body = JSON.stringify({ retryAfter: error.retryAfter ?? undefined });
    void handleRateLimitError(new Response(body, { status: 429 }), t);
  } else if (error instanceof SwapApiError) {
    toast.error(t(`swap.errors.${error.code}`));
  } else {
    toast.error(t("swap.errors.internal"));
  }
}

const STATUS_TONE: Record<SwapStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  open: "brand",
  accepted: "success",
  declined: "danger",
  withdrawn: "neutral",
  expired: "warning",
  cancelled: "neutral",
};

export type SwapCardAction = "accept" | "decline" | "hide" | "unhide" | "withdraw" | "chooseCounter" | "waive";
export type SwapCardMode = "forMe" | "mine" | "hidden" | "counter" | "manage";

export function SwapCard({
  entry,
  mode,
  currentUserId,
  busy,
  onAction,
}: {
  entry: BoardEntry;
  mode: SwapCardMode;
  currentUserId: string;
  busy: boolean;
  onAction: (action: SwapCardAction) => void;
}) {
  const t = useTranslations();
  const fmt = useDutyFormat();
  const offered = fmt(entry.offered);
  const fmtDate = useLocalDateFormat();
  const forced = entry.type === "forced";
  const kind = forced
    ? t("swap.kind.forced")
    : entry.type === "give"
      ? t("swap.kind.give")
      : entry.requested
        ? t("swap.kind.exchangeFor", { date: fmt(entry.requested).date })
        : t("swap.kind.exchangeAny");
  const counter =
    entry.counterStatus === "pending"
      ? t("swap.counter.pending")
      : entry.counterStatus === "chosen" && entry.accepted
        ? t("swap.counter.chosen", { date: fmt(entry.accepted).date })
        : entry.counterStatus === "waived"
          ? t("swap.counter.waived")
          : null;
  const audience = !entry.target
    ? t("swap.toAll")
    : entry.target.id === currentUserId
      ? t("swap.toYou")
      : t("swap.toUser", { name: entry.target.name ?? "?" });
  const who = forced
    ? t("swap.forcedFor", { name: entry.offeredBy.name ?? "?" })
    : mode === "mine" || mode === "manage"
      ? audience
      : t("swap.from", { name: entry.offeredBy.name ?? "?" });

  return (
    <article className="flex flex-col gap-2.5 rounded-[11px] border border-line bg-surface-card px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-fg-strong">
            {offered.date} · {offered.time}
          </div>
          <div className="truncate text-[13px] text-fg-secondary">
            {entry.offered.title} · {entry.calendarName}
          </div>
        </div>
        {mode === "mine" || mode === "manage" ? (
          <Pill tone={STATUS_TONE[entry.status]}>{t(`swap.status.${entry.status}`)}</Pill>
        ) : (
          entry.target?.id === currentUserId && <Pill tone="brand">{t("swap.toYou")}</Pill>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg-body">
        <ArrowLeftRight className="size-3.5 text-fg-tertiary" aria-hidden="true" />
        <span>{kind}</span>
        <span className="text-fg-tertiary">·</span>
        <span>{who}</span>
        {(mode === "mine" || mode === "manage") && entry.acceptedBy && (
          <>
            <span className="text-fg-tertiary">·</span>
            <span>{t("swap.acceptedBy", { name: entry.acceptedBy.name ?? "?" })}</span>
          </>
        )}
        {counter && (
          <>
            <span className="text-fg-tertiary">·</span>
            <span>{counter}</span>
          </>
        )}
      </div>

      {entry.note && <p className="text-[13px] italic text-fg-secondary">„{entry.note}“</p>}
      {entry.counterStatus === "waived" && entry.waiveReason && (
        <p className="text-[13px] italic text-fg-secondary">„{entry.waiveReason}“</p>
      )}
      {mode === "counter" && entry.counterWindowEnd && (
        <p className="text-[13px] text-fg-body">
          {t("swap.counter.task", { name: entry.offeredBy.name ?? "?", end: fmtDate(entry.counterWindowEnd) })}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {mode === "forMe" && (
          <>
            <Button size="sm" disabled={busy} onClick={() => onAction("accept")}>
              {forced ? t("swap.actions.coverIn") : t("swap.actions.swap")}
            </Button>
            {!forced && (entry.target ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("decline")}>
                <X className="size-4" />
                {t("swap.actions.decline")}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction("hide")}>
                <EyeOff className="size-4" />
                {t("swap.actions.hide")}
              </Button>
            ))}
          </>
        )}
        {mode === "hidden" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction("unhide")}>
            <Eye className="size-4" />
            {t("swap.actions.unhide")}
          </Button>
        )}
        {mode === "counter" && (
          <Button size="sm" disabled={busy} onClick={() => onAction("chooseCounter")}>
            <Repeat className="size-4" />
            {t("swap.counter.choose")}
          </Button>
        )}
        {mode === "manage" && entry.status === "open" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("withdraw")}>
            <Undo2 className="size-4" />
            {t("swap.actions.withdraw")}
          </Button>
        )}
        {mode === "manage" && entry.counterStatus === "pending" && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("chooseCounter")}>
              <Repeat className="size-4" />
              {t("swap.counter.chooseFor")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction("waive")}>
              <Ban className="size-4" />
              {t("swap.counter.waive")}
            </Button>
          </>
        )}
        {mode === "mine" && entry.status === "open" && !forced && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("withdraw")}>
            <Undo2 className="size-4" />
            {t("swap.actions.withdraw")}
          </Button>
        )}
      </div>
    </article>
  );
}
