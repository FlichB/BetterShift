// [fork] Eintragsvorlage (spec 2026-10-27 "Ein Eintrag pro Person"): the title of one Platz.
// Pure and database-free so the calendar (client) and Outlook/feed (server) share it.

export const ENTRY_TITLE_DEFAULT = "{Vorname} Dienst"; // same as the entry_title column default
export const ENTRY_TITLE_MAX = 100;

export type EntryTitleCheck = "ok" | "missingName" | "unknownPlaceholder" | "length";

export interface EntryHolder {
  name: string | null;
  email: string | null;
}

const PLACEHOLDER = /\{([^{}]*)\}/g;
const KNOWN = new Set(["Vorname", "Name", "Dienst"]);

export function validateEntryTitle(template: string): EntryTitleCheck {
  const trimmed = template.trim();
  if (trimmed.length < 1 || trimmed.length > ENTRY_TITLE_MAX) return "length";
  const used = [...trimmed.matchAll(PLACEHOLDER)].map((m) => m[1]);
  if (used.some((key) => !KNOWN.has(key))) return "unknownPlaceholder";
  if (/[{}]/.test(trimmed.replace(PLACEHOLDER, ""))) return "unknownPlaceholder"; // a stray brace
  if (!used.includes("Vorname") && !used.includes("Name")) return "missingName";
  return "ok";
}

/** The holder's name with collapsed whitespace, or the e-mail local part when there is none. */
export function holderDisplayName(holder: EntryHolder): string {
  const name = holder.name?.trim().replace(/\s+/g, " ");
  if (name) return name;
  return holder.email?.split("@")[0]?.trim() ?? "";
}

export function entryTitle(template: string, holder: EntryHolder, dutyTitle: string): string {
  const full = holderDisplayName(holder);
  const values: Record<string, string> = { Vorname: full.split(" ")[0] ?? "", Name: full, Dienst: dutyTitle.trim() };
  return template
    .replace(PLACEHOLDER, (match, key: string) => values[key] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}
