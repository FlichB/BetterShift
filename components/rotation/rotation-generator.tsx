"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, inputClass } from "@/components/form-kit";
import {
  useGenerateRotation,
  usePreviewRotation,
  useRemoveSlotLock,
  useSaveRotation,
  RotationApiError,
  type RotationCalendar,
} from "@/hooks/useRotations";
import { formatDateToLocal, formatLongDate, parseLocalDate } from "@/lib/date-utils";
import { handleRateLimitError } from "@/lib/rate-limit-client";
import { addDays } from "@/lib/rotation/dates";
import { inputFromRotation } from "@/lib/rotation/input";
import type { ClosureEntry, GenerationPlan, PlanEntry } from "@/lib/rotation/plan";
import type { RotationDetail } from "@/lib/rotation/service";
import { cn } from "@/lib/utils";

const WEEK_CHOICES = [4, 12, 26, 52];
const KINDS = ["create", "update", "unchanged", "delete"] as const;

export function RotationGenerator({
  rotation,
  calendar,
  onClose,
}: {
  rotation: RotationDetail;
  calendar: RotationCalendar;
  onClose: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const today = formatDateToLocal(new Date());
  // From the rotation's Beginn, but never before today: begun days are not written anyway.
  const start = rotation.startDate > today ? rotation.startDate : today;
  const [from, setFromRaw] = useState(start);
  const [to, setToRaw] = useState(addDays(start, 12 * 7 - 1));
  // The plan is stored with the range it was computed for; Apply uses exactly that range.
  const [shown, setShown] = useState<{ plan: GenerationPlan; from: string; to: string } | null>(null);
  const plan = shown?.plan ?? null;
  const setFrom = (value: string) => {
    setFromRaw(value);
    setShown(null);
  };
  const setTo = (value: string) => {
    setToRaw(value);
    setShown(null);
  };

  const preview = usePreviewRotation();
  const generate = useGenerateRotation();
  const save = useSaveRotation();
  const unlock = useRemoveSlotLock();

  const names = useMemo(() => new Map(calendar.members.map((m) => [m.id, m.name ?? m.id])), [calendar.members]);
  const name = (id: string) => names.get(id) ?? id;
  const day = (date: string) => formatLongDate(parseLocalDate(date), locale, { year: true, month: "short" });

  const onError = (error: unknown) => {
    if (error instanceof RotationApiError) {
      if (error.status === 429) {
        // An empty body makes the helper show its generic rate-limit toast
        void handleRateLimitError(new Response(null, { status: 429 }), t);
      } else {
        toast.error(t(`rotation.errors.${error.code}`));
      }
    } else {
      toast.error(t("rotation.errors.internal"));
    }
  };

  const load = (range: { from: string; to: string }) =>
    preview.mutate(
      { id: rotation.id, from: range.from, to: range.to },
      // The plan comes last: spreading a range object that carries a stale `plan` must never win
      { onSuccess: (result) => setShown({ from: range.from, to: range.to, plan: result }), onError }
    );
  const runPreview = () => load({ from, to });
  // Re-previews the range the user is currently looking at
  const reload = () => load({ from: shown?.from ?? from, to: shown?.to ?? to });

  const allKinds = [...(plan?.entries ?? []), ...(plan?.closures ?? [])].map((e) => e.kind);
  const pending = allKinds.filter((kind) => kind !== "unchanged");
  const overwritten = plan?.entries.reduce((n, e) => n + (e.kind === "update" ? e.remove.length : 0), 0) ?? 0;
  const counts = KINDS.map((kind) => ({ kind, n: allKinds.filter((k) => k === kind).length })).filter((c) => c.n > 0);
  const openHoliday = new Map(plan?.openHolidays.map((h) => [h.date, h.name]) ?? []);

  const markSkip = (date: string, reason: string) =>
    save.mutate(
      { id: rotation.id, input: { ...inputFromRotation(rotation), skipDates: [...rotation.skipDates, { date, reason }] } },
      { onSuccess: reload, onError }
    );
  const saveOpenDates = (holidayOpenDates: string[]) =>
    save.mutate({ id: rotation.id, input: { ...inputFromRotation(rotation), holidayOpenDates } }, { onSuccess: reload, onError });
  const keepOpen = (date: string) => saveOpenDates([...rotation.holidayOpenDates, date]);
  const closeAgain = (date: string) => saveOpenDates(rotation.holidayOpenDates.filter((d) => d !== date));

  return (
    <section className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("rotation.generator.from")}>
          <Input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("rotation.generator.to")}>
          <Input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {WEEK_CHOICES.map((weeks) => (
          <Button key={weeks} type="button" variant="outline" size="sm" onClick={() => setTo(addDays(from, weeks * 7 - 1))}>
            {t("rotation.generator.weeks", { count: weeks })}
          </Button>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={runPreview} disabled={preview.isPending}>
          {t("rotation.generator.preview")}
        </Button>
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={!shown || pending.length === 0 || generate.isPending}
          onClick={() =>
            generate.mutate(
              { id: rotation.id, from: shown!.from, to: shown!.to },
              {
                onSuccess: (summary) => {
                  toast.success(t("rotation.generator.applied", { ...summary }));
                  reload();
                },
                onError,
              }
            )
          }
        >
          {t("rotation.generator.apply")}
        </Button>
        <Button type="button" variant="ghost" className="w-full sm:ml-auto sm:w-auto" onClick={onClose}>
          {t("rotation.cancel")}
        </Button>
      </div>

      {plan && pending.length === 0 && <p className="text-sm text-fg-secondary">{t("rotation.generator.nothingToDo")}</p>}
      {counts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {counts.map((c) => (
            <Badge key={c.kind} variant="outline">
              {c.n} {t(`rotation.generator.kind.${c.kind}`)}
            </Badge>
          ))}
        </div>
      )}
      {overwritten > 0 && (
        <p className="text-sm text-amber-600">{t("rotation.generator.overwriteNotice", { count: overwritten })}</p>
      )}

      {plan && plan.warnings.length > 0 && (
        <div className="space-y-2 rounded-[9px] border border-amber-500/40 p-3">
          <h3 className="text-sm font-medium">{t("rotation.generator.warnings")}</h3>
          {plan.warnings.map((w) => (
            <div
              key={/* [fork] understaffed may have no shiftId */ `${w.kind}-${w.date}-${w.shiftId ?? ""}-${w.kind === "lockedNonMember" ? w.userId : ""}`}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="flex-1">
                {t(`rotation.generator.warning.${w.kind}`, {
                  date: day(w.date),
                  user: w.kind === "lockedNonMember" ? name(w.userId) : "",
                  count: "userIds" in w ? w.userIds.length : 0,
                  filled: w.kind === "understaffed" ? w.filled : 0, // [fork] Urlaub
                  capacity: w.kind === "understaffed" ? w.capacity : 0, // [fork] Urlaub
                })}
              </span>
              {w.kind === "lockedNonMember" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={unlock.isPending}
                  onClick={() =>
                    unlock.mutate({ id: rotation.id, shiftId: w.shiftId, userId: w.userId }, { onSuccess: reload, onError })
                  }
                >
                  {t("rotation.generator.unlock")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {plan && allKinds.length > 0 && (
        <div className="rounded-[9px] border border-line">
          <div className="hidden gap-4 border-b border-line px-3 py-2 text-xs font-semibold text-fg-secondary md:flex">
            <span className="w-48">{t("rotation.generator.date")}</span>
            <span className="flex-1">{t("rotation.generator.people")}</span>
            <span>{t("rotation.generator.change")}</span>
          </div>
          <ul className="divide-y divide-line">
            {[
              ...plan.entries.map((entry) => ({ date: entry.date, key: `duty-${entry.date}`, entry, closure: null })),
              ...plan.closures.map((closure) => ({ date: closure.date, key: `closed-${closure.date}`, entry: null, closure })),
            ]
              .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
              .map((row) =>
                row.entry ? (
                  <PlanRow
                    key={row.key}
                    entry={row.entry}
                    name={name}
                    perShift={rotation.perShift}
                    date={day(row.date)}
                    busy={save.isPending}
                    holiday={openHoliday.get(row.date) ?? null}
                    onSkip={(reason) => markSkip(row.date, reason)}
                    onCloseAgain={() => closeAgain(row.date)}
                  />
                ) : (
                  <ClosureRow key={row.key} closure={row.closure!} date={day(row.date)} busy={save.isPending} onKeepOpen={() => keepOpen(row.date)} />
                )
              )}
          </ul>
        </div>
      )}
    </section>
  );
}

function PlanRow({
  entry,
  name,
  perShift,
  date,
  busy,
  holiday,
  onSkip,
  onCloseAgain,
}: {
  entry: PlanEntry;
  name: (id: string) => string;
  perShift: number;
  date: string;
  busy: boolean;
  holiday: string | null;
  onSkip: (reason: string) => void;
  onCloseAgain: () => void;
}) {
  const t = useTranslations();
  const [reason, setReason] = useState<string | null>(null);
  const locked = entry.kind === "update" || entry.kind === "unchanged" ? entry.locked : [];
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5 md:flex-row md:items-center md:gap-4">
      <span className="font-medium md:w-48">{date}</span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1">
        {entry.userIds.map((id) => (
          <span key={id} className="inline-flex items-center gap-1" title={locked.includes(id) ? t("rotation.generator.locked") : undefined}>
            {locked.includes(id) && <Lock className="size-3.5" aria-label={t("rotation.generator.locked")} />}
            {name(id)}
          </span>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Badge variant={entry.kind === "unchanged" ? "secondary" : "default"}>{t(`rotation.generator.kind.${entry.kind}`)}</Badge>
        {entry.kind !== "delete" && entry.capacity > perShift && (
          <Badge variant="outline">{t("rotation.generator.reinforced", { count: entry.capacity })}</Badge>
        )}
        {entry.kind === "update" && (
          <span className="text-sm text-fg-secondary">
            {[...entry.add.map((id) => `+${name(id)}`), ...entry.remove.map((id) => `−${name(id)}`)].join(" ")}
            {entry.fieldsChanged && ` ${t("rotation.generator.fieldsChanged")}`}
            {entry.capacityChanged && ` ${t("rotation.generator.capacityChanged", { count: entry.capacity })}`}
          </span>
        )}
        {holiday && entry.kind !== "delete" && (
          <>
            <Badge variant="outline">{t("rotation.generator.openHoliday", { name: holiday })}</Badge>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCloseAgain}>
              {t("rotation.generator.closeAgain")}
            </Button>
          </>
        )}
        {entry.kind !== "delete" &&
          (reason === null ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setReason("")}>
              {t("rotation.generator.markSkip")}
            </Button>
          ) : (
            <span className="flex w-full items-center gap-2 md:w-auto">
              <Input
                autoFocus
                aria-label={t("rotation.generator.skipReason")}
                placeholder={t("rotation.generator.skipReason")}
                className={cn(inputClass, "h-8 min-w-0 flex-1 md:w-48")}
                maxLength={100}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button type="button" size="sm" disabled={busy || reason.trim() === ""} onClick={() => onSkip(reason.trim())}>
                {t("rotation.generator.skipConfirm")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setReason(null)}>
                {t("rotation.cancel")}
              </Button>
            </span>
          ))}
      </span>
    </li>
  );
}

function ClosureRow({
  closure,
  date,
  busy,
  onKeepOpen,
}: {
  closure: ClosureEntry;
  date: string;
  busy: boolean;
  onKeepOpen: () => void;
}) {
  const t = useTranslations();
  return (
    <li className="flex flex-col gap-1.5 bg-surface-panel/60 px-3 py-2.5 md:flex-row md:items-center md:gap-4">
      <span className="font-medium md:w-48">{date}</span>
      <span className="min-w-0 flex-1 text-fg-secondary">{closure.title}</span>
      <span className="flex flex-wrap items-center gap-2">
        <Badge variant={closure.kind === "unchanged" ? "secondary" : "default"}>{t(`rotation.generator.kind.${closure.kind}`)}</Badge>
        {closure.kind !== "delete" && closure.source === "holiday" && (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onKeepOpen}>
            {t("rotation.generator.keepOpen")}
          </Button>
        )}
      </span>
    </li>
  );
}
