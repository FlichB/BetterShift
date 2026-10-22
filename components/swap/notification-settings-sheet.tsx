"use client";

// [fork] Three switches for swap notification mails (spec 12.27), saved on every change.
import { useTranslations } from "next-intl";
import { MailX } from "lucide-react";
import { toast } from "sonner";
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
    >
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
        </div>
      )}
    </BaseSheet>
  );
}
