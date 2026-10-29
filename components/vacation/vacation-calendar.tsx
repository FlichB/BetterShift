"use client";

// [fork] Urlaubskalender for the Verwaltung: one row per person, the year as a time axis.
// Below the sm breakpoint a plain list per person replaces the grid.
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseLocalDate } from "@/lib/date-utils";
import { getDateLocale } from "@/lib/locales";
import { toDayNumber } from "@/lib/rotation/dates";
import type { VacationView } from "@/lib/vacation/types";
import { cn } from "@/lib/utils";
import { useVacationFormat } from "@/components/vacation/use-vacation-format";

const pad = (n: number) => String(n).padStart(2, "0");
// Pending requests are striped so they read as "not decided yet" without relying on colour alone.
const pendingStripes = {
  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 4px, rgb(255 255 255 / 0.55) 4px 7px)",
};

export function YearSwitcher({ year, onChange }: { year: number; onChange: (year: number) => void }) {
  const t = useTranslations();
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" aria-label={t("common.previous")} onClick={() => onChange(year - 1)}>
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-[3.5rem] text-center text-[15px] font-semibold tabular-nums text-fg-strong">{year}</span>
      <Button size="sm" variant="ghost" aria-label={t("common.next")} onClick={() => onChange(year + 1)}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

export function VacationCalendar({
  year,
  people,
  team,
}: {
  year: number;
  people: { id: string; name: string }[];
  team: VacationView[];
}) {
  const t = useTranslations();
  const fmt = useVacationFormat();
  const dateLocale = getDateLocale(useLocale());
  const first = toDayNumber(`${year}-01-01`);
  const days = toDayNumber(`${year + 1}-01-01`) - first;
  const pos = (date: string) => Math.min(Math.max(toDayNumber(date) - first, 0), days);
  const months = Array.from({ length: 12 }, (_, m) => {
    const date = `${year}-${pad(m + 1)}-01`;
    return { date, left: (pos(date) / days) * 100, label: format(parseLocalDate(date), "MMM", { locale: dateLocale }) };
  });
  const byPerson = new Map<string, VacationView[]>();
  for (const v of team) byPerson.set(v.user.id, [...(byPerson.get(v.user.id) ?? []), v]);
  const listed = people.filter((p) => byPerson.has(p.id));
  const label = (v: VacationView) =>
    `${v.user.name}: ${fmt.formatRange(v.startDate, v.endDate)} · ${fmt.statusLabel(v.status)}`;

  return (
    <>
      {/* Grid from sm up */}
      <div className="hidden rounded-[11px] border border-line bg-surface-card px-3.5 py-3 sm:block">
        <div className="flex text-[11px] text-fg-tertiary">
          <div className="w-28 shrink-0" />
          <div className="relative h-4 flex-1">
            {months.map((m) => (
              <span key={m.date} className="absolute top-0 pl-1" style={{ left: `${m.left}%` }}>
                {m.label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col">
          {people.map((p) => (
            <div key={p.id} className="flex items-center border-t border-line py-1">
              <div className="w-28 shrink-0 truncate pr-2 text-[13px] text-fg-body">{p.name}</div>
              <div className="relative h-5 flex-1">
                {months.map((m) => (
                  <span key={m.date} className="absolute inset-y-0 border-l border-line" style={{ left: `${m.left}%` }} />
                ))}
                {(byPerson.get(p.id) ?? []).map((v) => {
                  const left = pos(v.startDate);
                  const width = Math.max(Math.min(pos(v.endDate) + 1, days) - left, 1);
                  return (
                    <span
                      key={v.id}
                      title={label(v)}
                      aria-label={label(v)}
                      className={cn(
                        "absolute inset-y-0.5 rounded-[3px]",
                        v.status === "approved" ? "bg-violet-600" : "bg-violet-300"
                      )}
                      style={{
                        left: `${(left / days) * 100}%`,
                        width: `${(width / days) * 100}%`,
                        minWidth: 3,
                        ...(v.status === "approved" ? {} : pendingStripes),
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* List below sm */}
      <div className="flex flex-col gap-1.5 rounded-[11px] border border-line bg-surface-card px-3.5 py-3 sm:hidden">
        {listed.length === 0 ? (
          <p className="text-[13px] text-fg-tertiary">{t("vacation.emptyCalendar")}</p>
        ) : (
          listed.map((p) => (
            <p key={p.id} className="text-[13px] text-fg-body">
              <span className="font-medium text-fg-strong">{p.name}:</span>{" "}
              {(byPerson.get(p.id) ?? [])
                .map(
                  (v) =>
                    `${fmt.short(v.startDate)}–${fmt.short(v.endDate)}${v.status === "pending" ? ` (${fmt.statusLabel(v.status)})` : ""}`
                )
                .join(", ")}
            </p>
          ))
        )}
      </div>
    </>
  );
}
