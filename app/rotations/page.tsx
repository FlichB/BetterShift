"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { CalendarPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAuthFeatures } from "@/hooks/useAuthFeatures";
import {
  RotationApiError,
  useDeleteRotation,
  useRotationCalendars,
  useRotations,
  type RotationCalendar,
} from "@/hooks/useRotations";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FullscreenLoader } from "@/components/fullscreen-loader";
import { InfoNote, ListRow, Pill, inputClass, CheckRow } from "@/components/form-kit";
import { accountWideContentClass, AccountPageHeader } from "@/components/profile/account-layout";
import { RotationForm } from "@/components/rotation/rotation-form";
import { RotationGenerator } from "@/components/rotation/rotation-generator";
import { handleRateLimitError } from "@/lib/rate-limit-client";
import { parseLocalDate } from "@/lib/date-utils";
import { getDateLocale } from "@/lib/locales";
import type { RotationDetail } from "@/lib/rotation/service";
import { cn } from "@/lib/utils";

type ViewState = { mode: "list" } | { mode: "form"; rotationId?: string } | { mode: "generate"; rotationId: string };

export default function RotationsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAuthEnabled } = useAuthFeatures();
  const calendarsQuery = useRotationCalendars();
  const [calendarId, setCalendarId] = useState<string | undefined>();
  const [view, setView] = useState<ViewState>({ mode: "list" });
  const [deleting, setDeleting] = useState<RotationDetail | null>(null);
  const [deleteFuture, setDeleteFuture] = useState(false);
  const deleteRotation = useDeleteRotation();

  const calendars = calendarsQuery.data ?? [];
  const calendar: RotationCalendar | undefined = calendars.find((c) => c.id === calendarId) ?? calendars[0];
  const rotationsQuery = useRotations(calendar?.id);
  const rotations = rotationsQuery.data ?? [];

  useEffect(() => {
    if (isAuthEnabled && !authLoading && !user) {
      router.replace("/login?returnUrl=/rotations");
    }
  }, [isAuthEnabled, authLoading, user, router]);

  if (authLoading || (isAuthEnabled && !user) || calendarsQuery.isLoading) {
    return <FullscreenLoader />;
  }

  const dateLocale = getDateLocale(locale);
  const formatDay = (date: string) => format(parseLocalDate(date), "P", { locale: dateLocale });
  const editing = view.mode === "form" ? rotations.find((r) => r.id === view.rotationId) : undefined;
  // Looked up on every render so the generator sees the refetched rotation after "Fällt aus"
  const generating = view.mode === "generate" ? rotations.find((r) => r.id === view.rotationId) : undefined;

  const describe = (rotation: RotationDetail) => {
    const period =
      rotation.period === "days" ? `${rotation.periodDays} ${t("rotation.fields.periodDays")}` : t(`rotation.period.${rotation.period}`);
    const days =
      rotation.weekdays.length === 0
        ? t("rotation.allDays")
        : rotation.weekdays.map((d) => t(`rotation.weekday.${d as 1 | 2 | 3 | 4 | 5 | 6 | 7}`)).join(", ");
    return { period, days };
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteRotation.mutate(
      { id: deleting.id, deleteFutureDuties: deleteFuture },
      {
        onSuccess: (result) => toast.success(t("rotation.deleted", { count: result.deletedDuties })),
        onError: (error: RotationApiError) => {
          if (error.status === 429) void handleRateLimitError(new Response(null, { status: 429 }), t);
          else toast.error(t(`rotation.errors.${error.code}`));
        },
      }
    );
    setDeleting(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <AccountPageHeader title={t("rotation.title")} subtitle={t("rotation.subtitle")} backHref="/" />
      <main className={cn(accountWideContentClass, "mx-auto space-y-4 px-4 py-5")}>
        {calendars.length === 0 || !calendar ? (
          <InfoNote icon={Plus}>{t("rotation.noCalendars")}</InfoNote>
        ) : (
          <>
            {calendars.length > 1 && view.mode === "list" && (
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-fg-body">{t("rotation.calendar")}</label>
                <Select value={calendar.id} onValueChange={setCalendarId}>
                  <SelectTrigger className={cn(inputClass, "w-full")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {calendars.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!calendar.signupsEnabled && <InfoNote icon={Plus}>{t("rotation.signupsDisabled")}</InfoNote>}

            {view.mode === "form" ? (
              <>
                <h2 className="text-[16px] font-semibold text-fg-strong">{editing ? t("rotation.edit") : t("rotation.new")}</h2>
                <RotationForm
                  key={editing?.id ?? "new"}
                  calendar={calendar}
                  rotation={editing}
                  onDone={() => setView({ mode: "list" })}
                />
              </>
            ) : view.mode === "generate" && generating ? (
              <>
                <h2 className="text-[16px] font-semibold text-fg-strong">
                  {t("rotation.generator.title")}: {generating.name}
                </h2>
                <RotationGenerator
                  rotation={generating}
                  calendar={calendar}
                  onClose={() => setView({ mode: "list" })}
                />
              </>
            ) : (
              <>
                <Button className="w-full sm:w-auto" onClick={() => setView({ mode: "form" })}>
                  <Plus className="size-4" />
                  {t("rotation.new")}
                </Button>
                {rotations.length === 0 && !rotationsQuery.isLoading && (
                  <p className="text-sm text-fg-secondary">{t("rotation.empty")}</p>
                )}
                <ul className="space-y-3">
                  {rotations.map((rotation) => {
                    const preset = calendar.presets.find((p) => p.id === rotation.presetId);
                    const { period, days } = describe(rotation);
                    return (
                      <li key={rotation.id}>
                        <ListRow className="flex-col items-stretch gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-[15px] font-semibold text-fg-strong">{rotation.name}</h3>
                              {preset && <Pill tone="brand">{preset.title}</Pill>}
                            </div>
                            <p className="text-[13px] text-fg-secondary">
                              {t("rotation.summary", { members: rotation.memberIds.length, perShift: rotation.perShift })}
                            </p>
                            <p className="text-[13px] text-fg-secondary">
                              {period} · {formatDay(rotation.startDate)}
                            </p>
                            <p className="text-[13px] text-fg-secondary">{days}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => setView({ mode: "generate", rotationId: rotation.id })}>
                              <CalendarPlus className="size-3.5" />
                              {t("rotation.generator.title")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setView({ mode: "form", rotationId: rotation.id })}
                            >
                              <Pencil className="size-3.5" />
                              {t("rotation.edit")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-danger"
                              onClick={() => {
                                setDeleteFuture(false);
                                setDeleting(rotation);
                              }}
                            >
                              <Trash2 className="size-3.5" />
                              {t("common.delete")}
                            </Button>
                          </div>
                        </ListRow>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}
      </main>

      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("rotation.delete")}
        description={deleting ? t("rotation.deleteConfirm", { name: deleting.name }) : undefined}
        confirmText={t("common.delete")}
        confirmVariant="destructive"
        onConfirm={confirmDelete}
      >
        <CheckRow
          id="rotation-delete-future"
          checked={deleteFuture}
          onCheckedChange={setDeleteFuture}
          label={t("rotation.deleteFutureDuties")}
        />
      </ConfirmationDialog>
    </div>
  );
}
