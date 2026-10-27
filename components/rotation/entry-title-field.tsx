// [fork] Eintragsvorlage field: ⓘ popover (hover or tap) and a live preview with the first Teilnehmer.
"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Field, inputClass } from "@/components/form-kit";
import { ENTRY_TITLE_MAX, entryTitle, validateEntryTitle, type EntryHolder } from "@/lib/rotation/entry-title";

export function EntryTitleField({
  value,
  onChange,
  previewHolder,
  dutyTitle,
}: {
  value: string;
  onChange: (value: string) => void;
  previewHolder: EntryHolder | null;
  dutyTitle: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const inputId = useId();
  // Hover already opened the popover; a real mouse click must not toggle it shut again.
  const lastPointer = useRef<string>("");
  const valid = validateEntryTitle(value) === "ok";

  const label = (
    <span className="inline-flex items-center gap-1">
      {t("rotation.fields.entryTitle")}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          aria-label={t("rotation.fields.entryTitleInfo")}
          className="inline-flex size-5 items-center justify-center rounded-full text-fg-tertiary hover:text-fg-body"
          onPointerDown={(e) => (lastPointer.current = e.pointerType)}
          onClick={(e) => {
            if (lastPointer.current === "mouse" && e.detail > 0) e.preventDefault();
          }}
          onPointerEnter={(e) => {
            lastPointer.current = e.pointerType;
            if (e.pointerType === "mouse") setOpen(true);
          }}
          onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent className="max-w-72 text-xs leading-5" side="top">
          {t("rotation.fields.entryTitleHelp")}
        </PopoverContent>
      </Popover>
    </span>
  );

  return (
    <Field label={label} htmlFor={inputId} hint={t("rotation.fields.entryTitleHint")}>
      <Input
        id={inputId}
        className={inputClass}
        maxLength={ENTRY_TITLE_MAX}
        value={value}
        aria-invalid={!valid}
        onChange={(e) => onChange(e.target.value)}
      />
      {previewHolder && valid && (
        <p className="text-xs text-fg-tertiary">
          {t("rotation.fields.entryTitlePreview", { title: entryTitle(value, previewHolder, dutyTitle) })}
        </p>
      )}
    </Field>
  );
}
