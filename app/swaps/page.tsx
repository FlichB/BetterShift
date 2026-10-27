"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeftRight, Bell, CalendarSync, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAuthFeatures } from "@/hooks/useAuthFeatures";
import {
  useAcceptSwap,
  useChooseCounter,
  useDeclineSwap,
  useHideSwap,
  useSwapBoard,
  useWaiveCounter,
  useWithdrawSwap,
} from "@/hooks/useSwaps";
import { Button } from "@/components/ui/button";
import { FullscreenLoader } from "@/components/fullscreen-loader";
import { ChoiceChips, InfoNote } from "@/components/form-kit";
import { accountWideContentClass, AccountPageHeader } from "@/components/profile/account-layout";
import { AcceptDialog } from "@/components/swap/accept-dialog";
import { CounterDialog } from "@/components/swap/counter-dialog";
import { NotificationSettingsSheet } from "@/components/swap/notification-settings-sheet";
import { OfferSheet } from "@/components/swap/offer-sheet";
import { PersonalFeedSheet } from "@/components/swap/personal-feed-sheet";
import { WaiveDialog } from "@/components/swap/waive-dialog";
import { SwapCard, toastSwapError, type SwapCardAction } from "@/components/swap/swap-card";
import type { BoardEntry } from "@/lib/swap/types";
import { cn } from "@/lib/utils";

type Tab = "forMe" | "mine" | "manage";

export default function SwapsPage() {
  return (
    <Suspense fallback={<FullscreenLoader />}>
      <SwapsContent />
    </Suspense>
  );
}

function SwapsContent() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();
  const { isAuthEnabled } = useAuthFeatures();
  const [tab, setTab] = useState<Tab>("forMe");
  const [showHidden, setShowHidden] = useState(false);
  const [accepting, setAccepting] = useState<BoardEntry | null>(null);
  const [choosing, setChoosing] = useState<BoardEntry | null>(null);
  const [waiving, setWaiving] = useState<BoardEntry | null>(null);
  const offerShiftId = searchParams.get("offer") ?? undefined;
  const [offerOpen, setOfferOpen] = useState(Boolean(offerShiftId));
  // A fresh key per opening resets the sheet's form without remounting it while it closes.
  const [offerKey, setOfferKey] = useState(0);
  const openOffer = () => {
    setOfferKey((k) => k + 1);
    setOfferOpen(true);
  };
  const settingsParam = searchParams.get("settings");
  const [settingsOpen, setSettingsOpen] = useState(settingsParam === "notifications");
  const [feedOpen, setFeedOpen] = useState(settingsParam === "feed");

  const board = useSwapBoard(showHidden);
  const accept = useAcceptSwap();
  const decline = useDeclineSwap();
  const withdraw = useWithdrawSwap();
  const hide = useHideSwap();
  const chooseCounter = useChooseCounter();
  const waive = useWaiveCounter();
  const busy =
    accept.isPending || decline.isPending || withdraw.isPending || hide.isPending || chooseCounter.isPending || waive.isPending;

  useEffect(() => {
    if (!isAuthEnabled) router.replace("/");
    else if (!authLoading && !user) router.replace("/login?returnUrl=/swaps");
  }, [isAuthEnabled, authLoading, user, router]);

  if (authLoading || !user || board.isLoading) return <FullscreenLoader />;

  const data = board.data ?? { calendars: [], forMe: [], mine: [], hidden: [], pendingCounters: [], manage: [], manageCalendarIds: [] };
  const onError = (error: unknown) => toastSwapError(error, t);

  const act = (entry: BoardEntry, action: SwapCardAction) => {
    switch (action) {
      case "accept":
        setAccepting(entry);
        break;
      case "decline":
        decline.mutate({ id: entry.id }, { onSuccess: () => toast.success(t("swap.done.declined")), onError });
        break;
      case "withdraw":
        withdraw.mutate({ id: entry.id }, { onSuccess: () => toast.success(t("swap.done.withdrawn")), onError });
        break;
      case "chooseCounter":
        setChoosing(entry);
        break;
      case "waive":
        setWaiving(entry);
        break;
      case "hide":
      case "unhide":
        hide.mutate({ id: entry.id, hidden: action === "hide" }, { onError });
        break;
    }
  };

  const confirmAccept = (counterShiftId?: string) => {
    if (!accepting) return;
    const entry = accepting;
    setAccepting(null);
    accept.mutate(
      { id: entry.id, shiftId: counterShiftId },
      {
        onSuccess: () => toast.success(entry.type === "forced" ? t("swap.done.coveredIn") : t("swap.done.swapped")),
        onError,
      }
    );
  };

  const confirmCounter = (shiftId: string) => {
    if (!choosing) return;
    const entry = choosing;
    setChoosing(null);
    chooseCounter.mutate({ id: entry.id, shiftId }, { onSuccess: () => toast.success(t("swap.done.counterChosen")), onError });
  };
  const confirmWaive = (reason: string) => {
    if (!waiving) return;
    const entry = waiving;
    setWaiving(null);
    waive.mutate({ id: entry.id, reason }, { onSuccess: () => toast.success(t("swap.done.counterWaived")), onError });
  };

  const canManage = data.manageCalendarIds.length > 0;
  const hasBoard = data.calendars.length > 0 || canManage;
  const list = tab === "forMe" ? data.forMe : tab === "mine" ? data.mine : data.manage;

  return (
    <div className="min-h-screen bg-background">
      <AccountPageHeader
        title={t("swap.title")}
        subtitle={t("swap.subtitle")}
        backHref="/"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" aria-label={t("swap.feed.open")} onClick={() => setFeedOpen(true)}>
              <CalendarSync className="size-4" />
              <span className="hidden sm:inline">{t("swap.feed.open")}</span>
            </Button>
            <Button size="sm" variant="outline" aria-label={t("swap.notifications.open")} onClick={() => setSettingsOpen(true)}>
              <Bell className="size-4" />
              <span className="hidden sm:inline">{t("swap.notifications.open")}</span>
            </Button>
            {data.calendars.length > 0 && (
              <Button size="sm" aria-label={t("swap.offer")} onClick={openOffer}>
                <Plus className="size-4" />
                <span className="hidden sm:inline">{t("swap.offer")}</span>
              </Button>
            )}
          </div>
        }
      />
      <main className={cn(accountWideContentClass, "mx-auto space-y-4 px-4 py-5")}>
        {board.isError && !board.data ? (
          <div className="flex flex-col items-start gap-2.5">
            <InfoNote icon={AlertTriangle}>{t("swap.loadFailed")}</InfoNote>
            <Button size="sm" variant="outline" onClick={() => board.refetch()}>
              {t("swap.retry")}
            </Button>
          </div>
        ) : !hasBoard ? (
          <InfoNote icon={ArrowLeftRight}>{t("swap.noCalendars")}</InfoNote>
        ) : (
          <>
            <ChoiceChips<Tab>
              value={tab}
              onChange={setTab}
              label={t("swap.title")}
              options={[
                { value: "forMe", label: `${t("swap.tabs.forMe")} (${data.forMe.length + data.pendingCounters.length})` },
                { value: "mine", label: t("swap.tabs.mine") },
                ...(canManage ? [{ value: "manage" as const, label: `${t("swap.tabs.manage")} (${data.manage.length})` }] : []),
              ]}
            />

            {list.length === 0 && !(tab === "forMe" && data.pendingCounters.length > 0) && (
              <p className="rounded-[11px] border border-dashed border-control px-3.5 py-6 text-center text-[13px] text-fg-tertiary">
                {tab === "forMe" ? t("swap.emptyForMe") : tab === "mine" ? t("swap.emptyMine") : t("swap.emptyManage")}
              </p>
            )}
            <div className="flex flex-col gap-2.5">
              {tab === "forMe" &&
                data.pendingCounters.map((entry) => (
                  <SwapCard key={entry.id} entry={entry} mode="counter" currentUserId={user.id} busy={busy} onAction={(action) => act(entry, action)} />
                ))}
              {list.map((entry) => (
                <SwapCard
                  key={entry.id}
                  entry={entry}
                  mode={tab}
                  currentUserId={user.id}
                  busy={busy}
                  onAction={(action) => act(entry, action)}
                />
              ))}
            </div>

            {tab === "forMe" && (
              <div className="space-y-2.5">
                <Button size="sm" variant="ghost" onClick={() => setShowHidden((v) => !v)}>
                  {showHidden ? t("swap.hideHidden") : t("swap.showHidden")}
                </Button>
                {showHidden &&
                  data.hidden.map((entry) => (
                    <SwapCard
                      key={entry.id}
                      entry={entry}
                      mode="hidden"
                      currentUserId={user.id}
                      busy={busy}
                      onAction={(action) => act(entry, action)}
                    />
                  ))}
              </div>
            )}
          </>
        )}
      </main>

      {accepting && (
        <AcceptDialog entry={accepting} onCancel={() => setAccepting(null)} onConfirm={confirmAccept} />
      )}
      {choosing && <CounterDialog entry={choosing} onCancel={() => setChoosing(null)} onConfirm={confirmCounter} />}
      {waiving && <WaiveDialog entry={waiving} onCancel={() => setWaiving(null)} onConfirm={confirmWaive} />}
      {data.calendars.length > 0 && (
        <OfferSheet
          key={offerKey}
          open={offerOpen}
          onOpenChange={setOfferOpen}
          calendars={data.calendars}
          initial={{ calendarId: searchParams.get("calendar") ?? undefined, shiftId: offerShiftId }}
        />
      )}
      <NotificationSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
      <PersonalFeedSheet open={feedOpen} onOpenChange={setFeedOpen} />
    </div>
  );
}
