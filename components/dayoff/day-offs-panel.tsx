"use client";

// [fork] Content of the "Dienstfrei" tab on /swaps: own Dienstfreie and, for rotation managers, the management list.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChoiceChips, InfoNote, SectionLabel } from "@/components/form-kit";
import {
  useAcceptDayOffProposal,
  useCounterDayOff,
  useDeclineDayOffProposal,
  useLockDayOff,
  useMoveDayOff,
  useProposeDayOff,
} from "@/hooks/useDayOffs";
import type { DayOffBoard, DayOffProposalView, DayOffView } from "@/lib/dayoff/types";
import { DayOffCard, toastDayOffError, type DayOffCardAction, type DayOffCardMode } from "@/components/dayoff/day-off-card";
import { MoveDialog } from "@/components/dayoff/move-dialog";
import { ProposeDialog } from "@/components/dayoff/propose-dialog";
import { LockDialog } from "@/components/dayoff/lock-dialog";
import { DayOffCounterDialog } from "@/components/dayoff/counter-dialog";
import { AnswerDialog } from "@/components/dayoff/answer-dialog";

type OpenDialog =
  | { kind: "move" | "propose" | "lock" | "counter"; dayOff: DayOffView }
  | { kind: "decline"; dayOff: DayOffView; proposal: DayOffProposalView; mode: DayOffCardMode };

const ALL = "__all__";
const emptyClass = "rounded-[11px] border border-dashed border-control px-3.5 py-6 text-center text-[13px] text-fg-tertiary";

export function DayOffsPanel({
  board,
  isError,
  onRetry,
}: {
  board: DayOffBoard | undefined;
  isError: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [calendarFilter, setCalendarFilter] = useState<string>(ALL);
  const move = useMoveDayOff();
  const lock = useLockDayOff();
  const propose = useProposeDayOff();
  const counter = useCounterDayOff();
  const accept = useAcceptDayOffProposal();
  const decline = useDeclineDayOffProposal();
  const busy = move.isPending || lock.isPending || propose.isPending || counter.isPending || accept.isPending || decline.isPending;
  const onError = (error: unknown) => toastDayOffError(error, t);

  if (isError && !board) {
    return (
      <div className="flex flex-col items-start gap-2.5">
        <InfoNote icon={AlertTriangle}>{t("dayOff.loadFailed")}</InfoNote>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t("swap.retry")}
        </Button>
      </div>
    );
  }

  const mine = board?.mine ?? [];
  const manage = board?.manage ?? [];
  const canManage = (board?.manageCalendarIds.length ?? 0) > 0;
  const calendars = [...new Map(manage.map((d) => [d.calendarId, d.calendarName])).entries()];
  const filter = calendars.some(([id]) => id === calendarFilter) ? calendarFilter : ALL;
  const managed = filter === ALL ? manage : manage.filter((d) => d.calendarId === filter);

  const act = (dayOff: DayOffView, mode: DayOffCardMode) => (action: DayOffCardAction) => {
    if (action.kind === "accept") {
      accept.mutate({ id: action.proposal.id }, { onSuccess: () => toast.success(t("dayOff.done.accepted")), onError });
    } else if (action.kind === "decline") {
      setDialog({ kind: "decline", dayOff, proposal: action.proposal, mode });
    } else {
      setDialog({ kind: action.kind, dayOff });
    }
  };

  // Closes the dialog first so a failing request leaves the board, not a stale dialog, on screen.
  const close = () => setDialog(null);
  const done = (message: string) => ({ onSuccess: () => toast.success(message), onError });

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2.5">
        <SectionLabel>{t("dayOff.mineTitle")}</SectionLabel>
        {mine.length === 0 ? (
          <p className={emptyClass}>{t("dayOff.empty")}</p>
        ) : (
          mine.map((d) => <DayOffCard key={d.id} dayOff={d} mode="mine" busy={busy} onAction={act(d, "mine")} />)
        )}
      </section>

      {canManage && (
        <section className="flex flex-col gap-2.5">
          <SectionLabel>{t("dayOff.manageTitle")}</SectionLabel>
          {calendars.length > 1 && (
            <ChoiceChips<string>
              value={filter}
              onChange={setCalendarFilter}
              label={t("dayOff.manageTitle")}
              options={[
                { value: ALL, label: t("dayOff.allCalendars") },
                ...calendars.map(([id, name]) => ({ value: id, label: name })),
              ]}
            />
          )}
          {managed.length === 0 ? (
            <p className={emptyClass}>{t("dayOff.emptyManage")}</p>
          ) : (
            managed.map((d) => <DayOffCard key={d.id} dayOff={d} mode="manage" busy={busy} onAction={act(d, "manage")} />)
          )}
        </section>
      )}

      {dialog?.kind === "move" && (
        <MoveDialog
          dayOff={dialog.dayOff}
          onCancel={close}
          onConfirm={(date) => {
            close();
            move.mutate({ id: dialog.dayOff.id, date }, done(t("dayOff.done.moved")));
          }}
        />
      )}
      {dialog?.kind === "propose" && (
        <ProposeDialog
          dayOff={dialog.dayOff}
          onCancel={close}
          onConfirm={(dates) => {
            close();
            propose.mutate({ id: dialog.dayOff.id, dates }, done(t("dayOff.done.proposed")));
          }}
        />
      )}
      {dialog?.kind === "lock" && (
        <LockDialog
          dayOff={dialog.dayOff}
          onCancel={close}
          onConfirm={(note) => {
            close();
            lock.mutate({ id: dialog.dayOff.id, note }, done(t("dayOff.done.locked")));
          }}
        />
      )}
      {dialog?.kind === "counter" && (
        <DayOffCounterDialog
          dayOff={dialog.dayOff}
          onCancel={close}
          onConfirm={(date) => {
            close();
            counter.mutate({ id: dialog.dayOff.id, date }, done(t("dayOff.done.countered")));
          }}
        />
      )}
      {dialog?.kind === "decline" && (
        <AnswerDialog
          proposal={dialog.proposal}
          mode={dialog.mode}
          onCancel={close}
          onConfirm={(reason) => {
            close();
            decline.mutate({ id: dialog.proposal.id, reason }, done(t("dayOff.done.declined")));
          }}
        />
      )}
    </div>
  );
}
