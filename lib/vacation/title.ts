// [fork] Urlaub: the title of a vacation entry ("{Vorname} Urlaub"), the same in calendar, feed and Outlook.
import { entryTitle, type EntryHolder } from "@/lib/rotation/entry-title";

/** Server side (Outlook, feed): the mail locale's wording. Client side uses t("vacation.entryTitle", { name }). */
const TEMPLATES: Record<string, string> = {
  de: "{Vorname} Urlaub",
  en: "{Vorname} vacation",
  es: "{Vorname} vacaciones",
  fr: "{Vorname} congés",
  it: "{Vorname} ferie",
  cs: "{Vorname} dovolená",
};

export function firstNameOf(holder: EntryHolder): string {
  return entryTitle("{Vorname}", holder, "");
}

export function vacationTitle(holder: EntryHolder, locale = process.env.DEFAULT_LOCALE ?? "de"): string {
  return entryTitle(TEMPLATES[locale] ?? TEMPLATES.de, holder, "");
}
