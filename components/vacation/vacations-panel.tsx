"use client";

// [fork] Content of the "Urlaub" tab on /swaps: own vacations and, for the Verwaltung, open requests,
// the Urlaubskalender and entering vacations. Mutations are deliberately not optimistic: the server
// replans the duties and may refuse, so the UI waits for the response (buttons disabled while pending).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, CalendarPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoNote, SectionLabel } from "@/components/form-kit";
import { useVacationBoard, useVacationMutations } from "@/hooks/useVacations";
import type { VacationAction, VacationView } from "@/lib/vacation/types";
import {
  VacationCard,
  toastVacationError,
  vacationActions,
  type VacationCardAction,
  type VacationCardMode,
} from "@/components/vacation/vacation-card";
import { RequestSheet, type RequestSheetMode, type RequestSheetValues } from "@/components/vacation/request-sheet";
import { PreviewDialog } from "@/components/vacation/preview-dialog";
import { ReasonDialog } from "@/components/vacation/reason-dialog";
import { VacationCalendar, YearSwitcher } from "@/components/vacation/vacation-calendar";
import { todayLocal } from "@/components/vacation/use-vacation-format";

const emptyClass = "rounded-[11px] border border-dashed border-control px-3.5 py-6 text-center text-[13px] text-fg-tertiary";

interface SheetState {
  mode: RequestSheetMode;
  vacation?: VacationView;
}
interface PreviewState {
  action: VacationAction;
  confirmText: string;
  run: () => void;
}
interface ReasonState {
  kind: "reject" | "rejectChange" | "requestCancel";
  vacation: VacationView;
}

export function VacationsPanel() {
  const t = useTranslations();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const board = useVacationBoard(year);
  const m = useVacationMutations();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // A fresh key per opening resets the sheet's form without remounting it while it closes.
  const [sheetKey, setSheetKey] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [reason, setReason] = useState<ReasonState | null>(null);
  const busy = Object.values(m).some((mutation) => mutation.isPending);
  const onError = (error: unknown) => toastVacationError(error, t);
  const done = (message: string, after?: () => void) => ({
    onSuccess: () => {
      toast.success(message);
      after?.();
    },
    onError,
  });

  const openSheet = (mode: RequestSheetMode, vacation?: VacationView) => {
    setSheet({ mode, vacation });
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  };
  const closeSheet = () => setSheetOpen(false);

  const act = (v: VacationView) => (action: VacationCardAction) => {
    const change = v.pendingChange;
    switch (action) {
      case "withdraw":
        m.withdraw.mutate(v.id, done(t("vacation.done.withdrawn")));
        break;
      case "withdrawChange":
        if (change) m.withdrawChange.mutate(change.id, done(t("vacation.done.withdrawn")));
        break;
      case "requestChange":
        openSheet("requestChange", v);
        break;
      case "edit":
        openSheet("change", v);
        break;
      case "requestCancel":
      case "reject":
      case "rejectChange":
        setReason({ kind: action, vacation: v });
        break;
      case "approve":
        setPreview({
          action: { kind: "approve", vacationId: v.id },
          confirmText: t("vacation.actions.approve"),
          run: () => m.approve.mutate(v.id, done(t("vacation.done.approved"))),
        });
        break;
      case "approveChange":
        if (change)
          setPreview({
            action: { kind: "approveChange", changeId: change.id },
            confirmText: t("vacation.actions.approveChange"),
            run: () =>
              m.approveChange.mutate(
                change.id,
                done(change.kind === "cancel" ? t("vacation.done.cancelled") : t("vacation.done.changed"))
              ),
          });
        break;
      case "cancel":
        setPreview({
          action: { kind: "cancel", vacationId: v.id },
          confirmText: t("vacation.actions.cancel"),
          run: () => m.cancel.mutate(v.id, done(t("vacation.done.cancelled"))),
        });
        break;
    }
  };

  // Requests go straight to the server; changes to approved vacations show the replan first.
  // The sheet stays open under the preview and closes once the change succeeded.
  const submit = ({ userId, startDate, endDate, note }: RequestSheetValues) => {
    if (!sheet) return;
    const { mode, vacation } = sheet;
    if (mode === "request") {
      m.request.mutate({ startDate, endDate, note }, done(t("vacation.done.requested"), closeSheet));
    } else if (mode === "requestChange" && vacation) {
      m.requestChange.mutate(
        { id: vacation.id, kind: "change", startDate, endDate, note },
        done(t("vacation.done.changeRequested"), closeSheet)
      );
    } else if (mode === "enter" && userId) {
      setPreview({
        action: { kind: "enter", userId, startDate, endDate },
        confirmText: t("vacation.enter"),
        run: () => m.enter.mutate({ userId, startDate, endDate, note }, done(t("vacation.done.entered"), closeSheet)),
      });
    } else if (mode === "change" && vacation) {
      setPreview({
        action: { kind: "change", vacationId: vacation.id, startDate, endDate },
        confirmText: t("vacation.actions.edit"),
        run: () => m.change.mutate({ id: vacation.id, startDate, endDate }, done(t("vacation.done.changed"), closeSheet)),
      });
    }
  };

  const confirmReason = (text: string | null) => {
    if (!reason) return;
    const { kind, vacation } = reason;
    setReason(null);
    if (kind === "requestCancel") {
      m.requestChange.mutate({ id: vacation.id, kind: "cancel", note: text }, done(t("vacation.done.changeRequested")));
    } else if (kind === "reject" && text) {
      m.reject.mutate({ id: vacation.id, note: text }, done(t("vacation.done.rejected")));
    } else if (kind === "rejectChange" && text && vacation.pendingChange) {
      m.rejectChange.mutate({ id: vacation.pendingChange.id, note: text }, done(t("vacation.done.rejected")));
    }
  };

  const data = board.data;
  const today = todayLocal();
  const cards = (list: VacationView[], mode: VacationCardMode) =>
    list.map((v) => <VacationCard key={v.id} vacation={v} mode={mode} busy={busy} onAction={act(v)} />);
  // Approved vacations the Verwaltung can still change or cancel; the rest is visible in the calendar.
  const editable = (data?.team ?? []).filter((v) => vacationActions(v, "team", today).length > 0);

  return (
    <div className="flex flex-col gap-5">
      <YearSwitcher year={year} onChange={setYear} />

      {board.isError && !data ? (
        <div className="flex flex-col items-start gap-2.5">
          <InfoNote icon={AlertTriangle}>{t("vacation.loadFailed")}</InfoNote>
          <Button size="sm" variant="outline" onClick={() => board.refetch()}>
            {t("swap.retry")}
          </Button>
        </div>
      ) : !data ? (
        <p className="text-[13px] text-fg-secondary">{t("common.loading")}</p>
      ) : (
        <>
          {(data.canRequest || data.mine.length > 0) && (
            <section className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <SectionLabel className="mb-0">{t("vacation.mine")}</SectionLabel>
                {data.canRequest && (
                  <Button size="sm" onClick={() => openSheet("request")}>
                    <Plus className="size-4" />
                    {t("vacation.request")}
                  </Button>
                )}
              </div>
              {data.mine.length === 0 ? <p className={emptyClass}>{t("vacation.emptyMine")}</p> : cards(data.mine, "mine")}
            </section>
          )}

          {data.isManager && (
            <>
              <section className="flex flex-col gap-2.5">
                <SectionLabel className="mb-0">{t("vacation.requests")}</SectionLabel>
                {data.requests.length === 0 ? (
                  <p className={emptyClass}>{t("vacation.emptyRequests")}</p>
                ) : (
                  cards(data.requests, "request")
                )}
              </section>

              <section className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <SectionLabel className="mb-0">{t("vacation.calendar")}</SectionLabel>
                  <Button size="sm" variant="outline" onClick={() => openSheet("enter")}>
                    <CalendarPlus className="size-4" />
                    {t("vacation.enter")}
                  </Button>
                </div>
                <VacationCalendar year={year} people={data.people} team={data.team} />
                {cards(editable, "team")}
              </section>
            </>
          )}
        </>
      )}

      {sheet && (
        <RequestSheet
          key={sheetKey}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          mode={sheet.mode}
          vacation={sheet.vacation}
          people={data?.people ?? []}
          isSaving={busy}
          onSubmit={submit}
        />
      )}
      {preview && (
        <PreviewDialog
          action={preview.action}
          confirmText={preview.confirmText}
          onCancel={() => setPreview(null)}
          onConfirm={() => {
            setPreview(null);
            preview.run();
          }}
        />
      )}
      {reason && (
        <ReasonDialog
          title={
            reason.kind === "reject"
              ? t("vacation.actions.reject")
              : reason.kind === "rejectChange"
                ? t("vacation.actions.rejectChange")
                : t("vacation.actions.requestCancel")
          }
          description={
            reason.kind === "requestCancel"
              ? t("vacation.requestCancelHint")
              : t("vacation.rejectHint", { name: reason.vacation.user.name })
          }
          confirmText={
            reason.kind === "reject"
              ? t("vacation.actions.reject")
              : reason.kind === "rejectChange"
                ? t("vacation.actions.rejectChange")
                : t("vacation.actions.requestCancel")
          }
          required={reason.kind !== "requestCancel"}
          onCancel={() => setReason(null)}
          onConfirm={confirmReason}
        />
      )}
    </div>
  );
}
