"use client";

// [fork] Outlook switch, sync status and errors of one rotation (spec 12.24).
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format, formatDistanceToNow } from "date-fns";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ToggleRow } from "@/components/form-kit";
import { useOutlookStatus, useOutlookSyncNow, useSetOutlookEnabled } from "@/hooks/useRotationOutlook";
import { RotationApiError } from "@/hooks/useRotations";
import { parseLocalDate } from "@/lib/date-utils";
import { getDateLocale } from "@/lib/locales";

export function OutlookPanel({ rotationId }: { rotationId: string }) {
  const t = useTranslations();
  const dateLocale = getDateLocale(useLocale());
  const status = useOutlookStatus(rotationId);
  const setEnabled = useSetOutlookEnabled(rotationId);
  const syncNow = useOutlookSyncNow(rotationId);
  const [confirmOff, setConfirmOff] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const data = status.data;
  if (!data) return null;

  const onError = (error: unknown) => {
    if (error instanceof RotationApiError && error.status === 429) toast.error(t("rotation.outlook.errors.rateLimited"));
    else if (error instanceof RotationApiError && error.code === "outlookNotConfigured") toast.error(t("rotation.outlook.errors.outlookNotConfigured"));
    else toast.error(t("rotation.outlook.errors.generic"));
  };
  const toggle = (next: boolean) => {
    if (next) setEnabled.mutate(true, { onError });
    else setConfirmOff(true);
  };

  return (
    <div className="space-y-2 rounded-[11px] border border-control px-3.5 py-2.5">
      <ToggleRow
        id={`outlook-${rotationId}`}
        title={t("rotation.outlook.toggle")}
        description={data.configured ? t("rotation.outlook.toggleHint") : t("rotation.outlook.notConfigured")}
        checked={data.enabled}
        onCheckedChange={toggle}
        disabled={(!data.configured && !data.enabled) || setEnabled.isPending}
      />
      {data.enabled && data.configured && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-fg-secondary">
            {t("rotation.outlook.status", { synced: data.synced, total: data.total })}
            {data.failed > 0 && (
              <>
                {" · "}
                <button type="button" className="text-danger underline" onClick={() => setShowErrors((v) => !v)}>
                  {t("rotation.outlook.failed", { count: data.failed })}
                </button>
              </>
            )}
            {data.lastSyncedAt && (
              <>
                {" · "}
                {t("rotation.outlook.lastSync", {
                  ago: formatDistanceToNow(new Date(data.lastSyncedAt), { addSuffix: true, locale: dateLocale }),
                })}
              </>
            )}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={syncNow.isPending}
            onClick={() => syncNow.mutate(undefined, { onSuccess: () => toast.success(t("rotation.outlook.syncStarted")), onError })}
          >
            <RefreshCw className="size-3.5" />
            {t("rotation.outlook.syncNow")}
          </Button>
        </div>
      )}
      {showErrors && data.errors.length > 0 && (
        <ul className="space-y-1 text-[12.5px] text-fg-secondary">
          {data.errors.map((e) => (
            <li key={e.shiftId} className="break-words">
              <span className="font-semibold">{format(parseLocalDate(e.date), "P", { locale: dateLocale })}</span>: {e.message}
            </li>
          ))}
        </ul>
      )}
      <ConfirmationDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title={t("rotation.outlook.disableTitle")}
        description={t("rotation.outlook.disableConfirm")}
        confirmText={t("rotation.outlook.disable")}
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmOff(false);
          setEnabled.mutate(false, { onError });
        }}
      />
    </div>
  );
}
