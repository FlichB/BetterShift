"use client";

import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarMember } from "@/lib/types";

/** Ordered Teilnehmer picker: up/down buttons instead of drag, so it works one-handed on phones. */
export function MemberOrderList({
  members,
  value,
  onChange,
}: {
  members: CalendarMember[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations();
  const byId = new Map(members.map((m) => [m.id, m]));
  const available = members.filter((m) => !value.includes(m.id));

  const move = (index: number, delta: number) => {
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ol className="divide-y divide-line rounded-[9px] border border-line">
          {value.map((id, index) => (
            <li key={id} className="flex items-center gap-1 px-2 py-1.5 sm:gap-2 sm:px-3">
              <span className="w-6 shrink-0 text-right text-sm tabular-nums text-fg-secondary">{index + 1}.</span>
              <span className="min-w-0 flex-1 truncate pl-1">{byId.get(id)?.name ?? id}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("rotation.moveUp")} disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("rotation.moveDown")} disabled={index === value.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("rotation.removeMember")} onClick={() => onChange(value.filter((v) => v !== id))}>
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {available.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">{t("rotation.addMember")}</p>
          <div className="flex flex-wrap gap-2">
            {available.map((m) => (
              <Button key={m.id} type="button" variant="outline" size="sm" onClick={() => onChange([...value, m.id])}>
                <Plus className="size-3.5" />
                {m.name ?? m.id}
              </Button>
            ))}
          </div>
        </div>
      )}
      <p className="text-sm text-fg-secondary">{t("rotation.memberHint")}</p>
    </div>
  );
}
