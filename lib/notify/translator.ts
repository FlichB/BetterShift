// [fork] Translator for mails and Outlook event texts outside a request. Uses DEFAULT_LOCALE:
// the app stores no per-user language (spec 12.27).
import { createTranslator } from "next-intl";
import { defaultLocale } from "@/lib/locales";

export type MailTranslator = (key: string, values?: Record<string, string | number>) => string;

let cached: Promise<{ locale: string; t: MailTranslator }> | null = null;

export function getMailTranslator(): Promise<{ locale: string; t: MailTranslator }> {
  cached ??= import(`../../messages/${defaultLocale}.json`).then((module) => ({
    locale: defaultLocale,
    t: createTranslator({ locale: defaultLocale, messages: module.default }) as unknown as MailTranslator,
  }));
  return cached;
}
