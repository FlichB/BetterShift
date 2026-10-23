"use client";

// [fork] Personal ICS feed link with copy, regenerate and revoke (spec 12.20).
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { CalendarSync, Copy, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BaseSheet } from "@/components/ui/base-sheet";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { InfoNote } from "@/components/form-kit";
import { usePersonalFeed, useRevokePersonalFeed, useRotatePersonalFeed } from "@/hooks/usePersonalFeed";
import { getDateLocale } from "@/lib/locales";

export function PersonalFeedSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations();
  const dateLocale = getDateLocale(useLocale());
  const feed = usePersonalFeed(open);
  const rotate = useRotatePersonalFeed();
  const revoke = useRevokePersonalFeed();
  const [confirm, setConfirm] = useState<"regenerate" | "revoke" | null>(null);
  const info = feed.data;
  const busy = rotate.isPending || revoke.isPending;
  const onError = () => toast.error(t("swap.feed.failed"));

  const copy = async () => {
    if (!info?.url) return;
    try {
      await navigator.clipboard.writeText(info.url);
      toast.success(t("swap.feed.copied"));
    } catch {
      toast.error(t("swap.feed.copyFailed"));
    }
  };

  return (
    <BaseSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("swap.feed.title")}
      description={t("swap.feed.description")}
      showCancelButton={false} // every action applies at once; the header X closes the sheet
    >
      <div className="flex flex-col gap-3">
        {feed.isLoading && <p className="text-[13px] text-fg-secondary">{t("common.loading")}</p>}
        {feed.isError && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-danger">{t("swap.feed.loadFailed")}</p>
            <Button size="sm" variant="outline" onClick={() => feed.refetch()}>
              {t("swap.retry")}
            </Button>
          </div>
        )}
        {info && !info.url && (
          <Button disabled={busy} onClick={() => rotate.mutate(undefined, { onError })}>
            <CalendarSync className="size-4" />
            {t("swap.feed.create")}
          </Button>
        )}
        {info?.url && (
          <>
            <input
              readOnly
              value={info.url}
              aria-label={t("swap.feed.title")}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-[9px] border border-control bg-surface-card px-3 py-2 font-mono text-[12.5px]"
            />
            <p className="text-[12.5px] text-fg-tertiary">
              {info.lastUsedAt
                ? t("swap.feed.lastUsed", {
                    ago: formatDistanceToNow(new Date(info.lastUsedAt), { addSuffix: true, locale: dateLocale }),
                  })
                : t("swap.feed.neverUsed")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={copy}>
                <Copy className="size-4" />
                {t("swap.feed.copy")}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm("regenerate")}>
                <RefreshCw className="size-4" />
                {t("swap.feed.regenerate")}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm("revoke")}>
                <Trash2 className="size-4" />
                {t("swap.feed.revoke")}
              </Button>
            </div>
          </>
        )}
        <div className="space-y-1.5 text-[13px] text-fg-secondary">
          <p className="font-semibold text-fg-primary">{t("swap.feed.howTo")}</p>
          <p>{t("swap.feed.google")}</p>
          <p>{t("swap.feed.apple")}</p>
          <p>{t("swap.feed.outlook")}</p>
        </div>
        <InfoNote icon={CalendarSync}>{t("swap.feed.outlookHint")}</InfoNote>
        <p className="text-[12.5px] text-fg-tertiary">{t("swap.feed.delayHint")}</p>
      </div>
      <ConfirmationDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "revoke" ? t("swap.feed.revokeTitle") : t("swap.feed.regenerateTitle")}
        description={confirm === "revoke" ? t("swap.feed.revokeConfirm") : t("swap.feed.regenerateConfirm")}
        confirmText={confirm === "revoke" ? t("swap.feed.revoke") : t("swap.feed.regenerate")}
        confirmVariant="destructive"
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action === "revoke") revoke.mutate(undefined, { onError });
          else rotate.mutate(undefined, { onError });
        }}
      />
    </BaseSheet>
  );
}
