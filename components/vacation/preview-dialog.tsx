"use client";

// [fork] Shows what an Urlaub action does to the duties before it is confirmed (POST /api/vacations/preview).
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { usePreview } from "@/hooks/useVacations";
import type { PlanWarning } from "@/lib/rotation/plan";
import type { VacationAction } from "@/lib/vacation/types";
import { useVacationFormat } from "@/components/vacation/use-vacation-format";
import { vacationErrorMessage } from "@/components/vacation/vacation-card";

export function PreviewDialog({
  action,
  confirmText,
  onCancel,
  onConfirm,
}: {
  action: VacationAction;
  confirmText: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations();
  const fmt = useVacationFormat();
  const preview = usePreview();
  const { mutate } = preview;

  // The dialog is mounted per action, so this runs once per opening; errors show inline.
  useEffect(() => {
    mutate(action);
  }, [action, mutate]);

  // lockedNonMember names a person the preview carries no name for; the generator preview shows it.
  const shown = (w: PlanWarning): w is Exclude<PlanWarning, { kind: "lockedNonMember" }> => w.kind !== "lockedNonMember";
  const rotations = (preview.data?.rotations ?? []).filter((r) => r.changes.length > 0 || r.warnings.some(shown));
  const names = (list: string[]) => (list.length > 0 ? list.join(", ") : "–");
  const warningText = (w: Exclude<PlanWarning, { kind: "lockedNonMember" }>) => {
    switch (w.kind) {
      case "understaffed":
        return t("vacation.preview.understaffed", { date: fmt.day(w.date), filled: w.filled, capacity: w.capacity });
      case "lockedWithoutDuty":
        return t("rotation.generator.warning.lockedWithoutDuty", { date: fmt.day(w.date) });
      case "lockedOverCapacity":
        return t("rotation.generator.warning.lockedOverCapacity", { date: fmt.day(w.date), count: w.userIds.length });
    }
  };

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t("vacation.preview.title")}
      description={t("vacation.preview.hint")}
      confirmText={confirmText}
      confirmDisabled={!preview.isSuccess}
      onConfirm={onConfirm}
    >
      <div className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto">
        {(preview.isIdle || preview.isPending) && (
          <p className="flex items-center gap-2 text-[13px] text-fg-secondary">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t("vacation.preview.loading")}
          </p>
        )}
        {preview.isError && <p className="text-[13px] text-danger">{vacationErrorMessage(preview.error, t)}</p>}
        {preview.isSuccess && rotations.length === 0 && (
          <p className="text-[13px] text-fg-secondary">{t("vacation.preview.none")}</p>
        )}
        {rotations.map((r) => (
          <section key={r.rotationId} className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-fg-strong">
              {t("vacation.preview.rotation", { rotation: r.rotationName, calendar: r.calendarName })}
            </h3>
            {r.warnings.filter(shown).map((w) => (
              <p key={`${w.kind}-${w.date}`} className="flex items-start gap-1.5 text-[12.5px] text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {warningText(w)}
              </p>
            ))}
            {r.changes.length > 0 && (
              <table className="w-full table-fixed text-left text-[12.5px]">
                <thead className="text-fg-tertiary">
                  <tr>
                    <th className="w-[30%] pb-1 pr-2 font-medium">{t("vacation.preview.date")}</th>
                    <th className="pb-1 pr-2 font-medium">{t("vacation.preview.before")}</th>
                    <th className="pb-1 font-medium">{t("vacation.preview.after")}</th>
                  </tr>
                </thead>
                <tbody className="align-top text-fg-body">
                  {r.changes.map((c) => (
                    <tr key={c.date} className="border-t border-line">
                      <td className="py-1 pr-2">{fmt.short(c.date)}</td>
                      <td className="break-words py-1 pr-2 text-fg-secondary line-through">{names(c.before)}</td>
                      <td className="break-words py-1 font-medium">{names(c.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </div>
    </ConfirmationDialog>
  );
}
