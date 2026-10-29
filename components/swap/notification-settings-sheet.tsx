"use client";

// [fork] Switches for swap, Dienstfrei and Urlaub notification mails (spec 12.27), saved on every change.
import { useTranslations } from "next-intl";
import { MailX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BaseSheet } from "@/components/ui/base-sheet";
import { InfoNote, ToggleRow } from "@/components/form-kit";
import { useNotificationSettings, useSaveNotificationPreferences } from "@/hooks/useNotificationPreferences";
import type { NotificationPreferences } from "@/lib/notify/types";

export function NotificationSettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations();
  const settings = useNotificationSettings(open);
  const save = useSaveNotificationPreferences();
  const data = settings.data;

  const change = (key: keyof NotificationPreferences) => (value: boolean) => {
    if (!data) return;
    save.mutate({ ...data.preferences, [key]: value }, { onError: () => toast.error(t("swap.notifications.saveFailed")) });
  };

  return (
    <BaseSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("swap.notifications.title")}
      description={t("swap.notifications.description")}
      showCancelButton={false} // saved on every toggle; the header X closes the sheet
    >
      {settings.isLoading && <p className="text-[13px] text-fg-secondary">{t("common.loading")}</p>}
      {settings.isError && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-danger">{t("swap.notifications.loadFailed")}</p>
          <Button size="sm" variant="outline" onClick={() => settings.refetch()}>
            {t("swap.retry")}
          </Button>
        </div>
      )}
      {data && (
        <div className="flex flex-col gap-3">
          {!data.configured && <InfoNote icon={MailX}>{t("swap.notifications.notConfigured")}</InfoNote>}
          <ToggleRow
            id="notify-offers-to-all"
            title={t("swap.notifications.offersToAll")}
            description={t("swap.notifications.offersToAllHint")}
            checked={data.preferences.offersToAll}
            onCheckedChange={change("offersToAll")}
          />
          <ToggleRow
            id="notify-offers-to-me"
            title={t("swap.notifications.offersToMe")}
            description={t("swap.notifications.offersToMeHint")}
            checked={data.preferences.offersToMe}
            onCheckedChange={change("offersToMe")}
          />
          <ToggleRow
            id="notify-my-offers"
            title={t("swap.notifications.myOffers")}
            description={t("swap.notifications.myOffersHint")}
            checked={data.preferences.myOffers}
            onCheckedChange={change("myOffers")}
          />
          <ToggleRow
            id="notify-my-day-offs"
            title={t("swap.notifications.myDayOffs")}
            description={t("swap.notifications.myDayOffsHint")}
            checked={data.preferences.myDayOffs}
            onCheckedChange={change("myDayOffs")}
          />
          <ToggleRow
            id="notify-day-off-requests"
            title={t("swap.notifications.dayOffRequests")}
            description={t("swap.notifications.dayOffRequestsHint")}
            checked={data.preferences.dayOffRequests}
            onCheckedChange={change("dayOffRequests")}
          />
          {/* [fork] Urlaub */}
          <ToggleRow
            id="notify-my-vacations"
            title={t("swap.notifications.myVacations")}
            description={t("swap.notifications.myVacationsHint")}
            checked={data.preferences.myVacations}
            onCheckedChange={change("myVacations")}
          />
          <ToggleRow
            id="notify-vacation-requests"
            title={t("swap.notifications.vacationRequests")}
            description={t("swap.notifications.vacationRequestsHint")}
            checked={data.preferences.vacationRequests}
            onCheckedChange={change("vacationRequests")}
          />
        </div>
      )}
    </BaseSheet>
  );
}
