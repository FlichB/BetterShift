"use client";

// [fork] Jahresausgleich (SPEC 12.41): Delta per Teilnehmer with a manager's override.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inputClass } from "@/components/form-kit";
import { useSetYearDelta, useYearDeltas } from "@/hooks/useRotationYearDeltas";
import { handleRateLimitError } from "@/lib/rate-limit-client";
import { MAX_YEAR_DELTA } from "@/lib/rotation/yearly";
import type { CalendarMember } from "@/lib/types";
import { cn } from "@/lib/utils";

// Codes the year-deltas routes answer with; anything else shows the generic error.
const KNOWN_ERRORS = new Set(["yearDelta", "notMember", "forbidden", "notFound", "internal"]);

export function YearDeltaPanel({ rotationId, members }: { rotationId: string; members: CalendarMember[] }) {
  const t = useTranslations();
  const { data: tables, isLoading } = useYearDeltas(rotationId);
  const setDelta = useSetYearDelta(rotationId);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  // Bumped after a rejected save so every input remounts with the rolled-back value.
  const [failures, setFailures] = useState(0);
  const save = (year: number, userId: string, delta: number | null) =>
    setDelta.mutate(
      { year, userId, delta },
      {
        onError: (error) => {
          setFailures((n) => n + 1);
          if (error.status === 429) {
            // An empty body makes the helper show its generic rate-limit toast
            void handleRateLimitError(new Response(null, { status: 429 }), t);
          } else {
            toast.error(t(`rotation.errors.${KNOWN_ERRORS.has(error.code) ? error.code : "internal"}`));
          }
        },
      }
    );

  if (isLoading || !tables) return null;
  if (tables.length === 0) return <p className="text-xs text-fg-tertiary">{t("rotation.yearly.noData")}</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-tertiary">{t("rotation.yearly.hint")}</p>
      {tables.map((table) => (
        <div key={table.year} className="space-y-1">
          <p className="text-[13px] font-medium text-fg-strong">{t("rotation.yearly.tableTitle", { from: table.year - 1, to: table.year })}</p>
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="text-left text-xs text-fg-tertiary">
                <th className="py-1 font-normal">{t("rotation.yearly.member")}</th>
                <th className="w-16 py-1 text-right font-normal">{t("rotation.yearly.held", { year: table.year - 1 })}</th>
                <th className="w-14 py-1 text-right font-normal">{t("rotation.yearly.autoDelta")}</th>
                <th className="w-28 py-1 text-right font-normal">{t("rotation.yearly.override")}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.userId} className="border-t border-line">
                  <td className="py-1.5 pr-2">
                    <span className="block truncate">{nameOf(row.userId)}</span>
                    {!row.fullYear && (
                      <span className="block text-xs text-fg-tertiary">{t("rotation.yearly.newSince", { date: row.joinedOn })}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{row.held}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.autoDelta}</td>
                  <td className="py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        key={`${row.userId}-${row.override}-${failures}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MAX_YEAR_DELTA}
                        aria-label={t("rotation.yearly.overrideFor", { name: nameOf(row.userId), year: table.year })}
                        className={cn(inputClass, "w-16 text-right")}
                        defaultValue={row.override ?? ""}
                        placeholder={String(row.autoDelta)}
                        onKeyDown={(e) => {
                          // Enter would submit the surrounding rotation form.
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.currentTarget.blur();
                          }
                        }}
                        onBlur={(e) => {
                          const raw = e.currentTarget.value.trim();
                          const next = raw === "" ? null : Number(raw);
                          if (next !== row.override) save(table.year, row.userId, next);
                        }}
                      />
                      {row.override !== null && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("rotation.yearly.reset")}
                          onClick={() => save(table.year, row.userId, null)}
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
