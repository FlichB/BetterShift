"use client";

// [fork] One Urlaub on the /swaps "Urlaub" tab, with the actions its mode and status allow.
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, Check, Pencil, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/form-kit";
import { SwapApiError } from "@/hooks/useSwaps";
import { handleRateLimitError } from "@/lib/rate-limit-client";
import type { VacationStatus, VacationView } from "@/lib/vacation/types";
import { todayLocal, useVacationFormat } from "@/components/vacation/use-vacation-format";

type T = ReturnType<typeof useTranslations>;

/** Literal keys per code so the i18n check sees every vacation.errors.* text. */
function vacationErrorText(t: T, code: string): string | null {
  switch (code) {
    case "notFound":
      return t("vacation.errors.notFound");
    case "forbidden":
      return t("vacation.errors.forbidden");
    case "invalid":
      return t("vacation.errors.invalid");
    case "reasonRequired":
      return t("vacation.errors.reasonRequired");
    case "tooLong":
      return t("vacation.errors.tooLong");
    case "notParticipant":
      return t("vacation.errors.notParticipant");
    case "begun":
      return t("vacation.errors.begun");
    case "overlap":
      return t("vacation.errors.overlap");
    case "wrongStatus":
      return t("vacation.errors.wrongStatus");
    case "changePending":
      return t("vacation.errors.changePending");
    case "rotationUnavailable":
      return t("vacation.errors.rotationUnavailable");
    default:
      return null;
  }
}

/** The text for a failed request: vacation.errors.<code> when known, the generic error otherwise. */
export function vacationErrorMessage(error: unknown, t: T): string {
  return (error instanceof SwapApiError ? vacationErrorText(t, error.code) : null) ?? t("swap.errors.internal");
}

export function toastVacationError(error: unknown, t: T): void {
  if (error instanceof SwapApiError && error.status === 429) {
    const body = JSON.stringify({ retryAfter: error.retryAfter ?? undefined });
    void handleRateLimitError(new Response(body, { status: 429 }), t);
  } else {
    toast.error(vacationErrorMessage(error, t));
  }
}

const STATUS_TONE: Record<VacationStatus, "neutral" | "brand" | "success" | "danger" | "violet"> = {
  pending: "brand",
  approved: "violet",
  rejected: "danger",
  withdrawn: "neutral",
  cancelled: "neutral",
};

export type VacationCardMode = "mine" | "request" | "team";
export type VacationCardAction =
  | "withdraw"
  | "requestChange"
  | "requestCancel"
  | "withdrawChange"
  | "approve"
  | "reject"
  | "approveChange"
  | "rejectChange"
  | "edit"
  | "cancel";

/** The actions a card offers; begun days are immutable, so a running vacation can only change its end. */
export function vacationActions(vacation: VacationView, mode: VacationCardMode, today: string): VacationCardAction[] {
  const { status, pendingChange, startDate, endDate } = vacation;
  const changeable = status === "approved" && endDate >= today;
  const cancellable = status === "approved" && startDate > today;
  switch (mode) {
    case "mine":
      if (status === "pending") return ["withdraw"];
      if (pendingChange) return ["withdrawChange"];
      return [...(changeable ? ["requestChange" as const] : []), ...(cancellable ? ["requestCancel" as const] : [])];
    case "request":
      if (status === "pending") return ["approve", "reject"];
      return pendingChange ? ["approveChange", "rejectChange"] : [];
    case "team":
      if (pendingChange) return [];
      return [...(changeable ? ["edit" as const] : []), ...(cancellable ? ["cancel" as const] : [])];
  }
}

export function VacationCard({
  vacation,
  mode,
  busy,
  onAction,
}: {
  vacation: VacationView;
  mode: VacationCardMode;
  busy: boolean;
  onAction: (action: VacationCardAction) => void;
}) {
  const t = useTranslations();
  const fmt = useVacationFormat();
  const actions = vacationActions(vacation, mode, todayLocal());
  const change = vacation.pendingChange;
  const has = (a: VacationCardAction) => actions.includes(a);
  const button = (action: VacationCardAction, label: string, icon: React.ReactNode, primary = false) =>
    has(action) && (
      <Button key={action} size="sm" variant={primary ? "default" : "outline"} disabled={busy} onClick={() => onAction(action)}>
        {icon}
        {label}
      </Button>
    );

  return (
    <article className="flex flex-col gap-2.5 rounded-[11px] border border-line bg-surface-card px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-fg-strong">{fmt.formatRange(vacation.startDate, vacation.endDate)}</div>
          {(mode !== "mine" || vacation.direct) && (
            <div className="truncate text-[13px] text-fg-secondary">
              {mode !== "mine" && vacation.user.name}
              {mode !== "mine" && vacation.direct && " · "}
              {vacation.direct && t("vacation.direct")}
            </div>
          )}
        </div>
        <Pill tone={STATUS_TONE[vacation.status]}>{fmt.statusLabel(vacation.status)}</Pill>
      </div>

      {vacation.note && <p className="text-[13px] italic text-fg-secondary">„{vacation.note}“</p>}
      {vacation.decisionNote && (
        <p className="text-[13px] text-fg-body">
          <span className="font-medium">{t("vacation.reason")}:</span> {vacation.decisionNote}
        </p>
      )}

      {change && (
        <div className="flex flex-col gap-1 rounded-[9px] bg-surface-panel px-3 py-2 text-[13px]">
          <div className="flex items-center gap-2 font-medium text-fg-strong">
            <CalendarClock className="size-3.5 shrink-0 text-fg-tertiary" aria-hidden="true" />
            {change.kind === "change" && change.startDate && change.endDate
              ? t("vacation.pendingChange.change", { range: fmt.formatRange(change.startDate, change.endDate) })
              : t("vacation.pendingChange.cancel")}
          </div>
          {change.note && <p className="italic text-fg-secondary">„{change.note}“</p>}
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {button("approve", t("vacation.actions.approve"), <Check className="size-4" />, true)}
          {button("reject", t("vacation.actions.reject"), <X className="size-4" />)}
          {button("approveChange", t("vacation.actions.approveChange"), <Check className="size-4" />, true)}
          {button("rejectChange", t("vacation.actions.rejectChange"), <X className="size-4" />)}
          {button("withdraw", t("vacation.actions.withdraw"), <Undo2 className="size-4" />)}
          {button("withdrawChange", t("vacation.actions.withdrawChange"), <Undo2 className="size-4" />)}
          {button("requestChange", t("vacation.actions.requestChange"), <Pencil className="size-4" />)}
          {button("requestCancel", t("vacation.actions.requestCancel"), <X className="size-4" />)}
          {button("edit", t("vacation.actions.edit"), <Pencil className="size-4" />)}
          {button("cancel", t("vacation.actions.cancel"), <X className="size-4" />)}
        </div>
      )}
    </article>
  );
}
