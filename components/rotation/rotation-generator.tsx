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
import type { GenerationPlan, PlanEntry } from "@/lib/rotation/plan";
import type { RotationDetail } from "@/lib/rotation/service";

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
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 12 * 7 - 1));
  const [plan, setPlan] = useState<GenerationPlan | null>(null);

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

  const reload = () => preview.mutate({ id: rotation.id, from, to }, { onSuccess: setPlan, onError });

  const pending = plan?.entries.filter((e) => e.kind !== "unchanged") ?? [];
  const overwritten = plan?.entries.reduce((n, e) => n + (e.kind === "update" ? e.remove.length : 0), 0) ?? 0;
  const counts = KINDS.map((kind) => ({ kind, n: plan?.entries.filter((e) => e.kind === kind).length ?? 0 })).filter(
    (c) => c.n > 0
  );

  const markSkip = (date: string) =>
    save.mutate(
      {
        id: rotation.id,
        input: {
          name: rotation.name,
          calendarId: rotation.calendarId,
          presetId: rotation.presetId ?? "",
          memberIds: rotation.memberIds,
          perShift: rotation.perShift,
          period: rotation.period,
          periodDays: rotation.periodDays,
          startDate: rotation.startDate,
          startOffset: rotation.startOffset,
          weekdays: rotation.weekdays,
          skipDates: [...rotation.skipDates, date],
        },
      },
      { onSuccess: reload, onError }
    );

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
        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={reload} disabled={preview.isPending}>
          {t("rotation.generator.preview")}
        </Button>
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={!plan || pending.length === 0 || generate.isPending}
          onClick={() =>
            generate.mutate(
              { id: rotation.id, from, to },
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
              key={`${w.kind}-${w.shiftId}-${w.kind === "lockedNonMember" ? w.userId : ""}`}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="flex-1">
                {t(`rotation.generator.warning.${w.kind}`, {
                  date: day(w.date),
                  user: w.kind === "lockedNonMember" ? name(w.userId) : "",
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

      {plan && plan.entries.length > 0 && (
        <div className="rounded-[9px] border border-line">
          <div className="hidden gap-4 border-b border-line px-3 py-2 text-xs font-semibold text-fg-secondary md:flex">
            <span className="w-48">{t("rotation.generator.date")}</span>
            <span className="flex-1">{t("rotation.generator.people")}</span>
            <span>{t("rotation.generator.change")}</span>
          </div>
          <ul className="divide-y divide-line">
            {plan.entries.map((entry) => (
              <PlanRow key={entry.date} entry={entry} name={name} date={day(entry.date)} onSkip={() => markSkip(entry.date)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function PlanRow({
  entry,
  name,
  date,
  onSkip,
}: {
  entry: PlanEntry;
  name: (id: string) => string;
  date: string;
  onSkip: () => void;
}) {
  const t = useTranslations();
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
        {entry.kind === "update" && (
          <span className="text-sm text-fg-secondary">
            {[...entry.add.map((id) => `+${name(id)}`), ...entry.remove.map((id) => `−${name(id)}`)].join(" ")}
            {entry.fieldsChanged && ` ${t("rotation.generator.fieldsChanged")}`}
          </span>
        )}
        {entry.kind !== "delete" && (
          <Button type="button" size="sm" variant="ghost" onClick={onSkip}>
            {t("rotation.generator.markSkip")}
          </Button>
        )}
      </span>
    </li>
  );
}
