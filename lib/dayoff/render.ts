// [fork] Dienstfrei mail texts. Pure apart from the translator passed in.
// Translation keys stay literal string arguments of t() so scripts/i18n-checks.ts can see them.
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import type { DayOffNotificationKind } from "@/lib/dayoff/types";
import { getDateLocale } from "@/lib/locales";
import { escapeHtml } from "@/lib/notify/render";
import type { MailTranslator } from "@/lib/notify/translator";

export interface DayOffMailContext {
  kind: DayOffNotificationKind;
  holderName: string;
  dutyDate: string;
  date: string | null;
  proposedDates: string[];
  reason: string | null;
  note: string | null;
  appUrl: string;
}

const day = (date: string, locale: string) => format(parseLocalDate(date), "EEEE, P", { locale: getDateLocale(locale) });

function subjectOf(kind: DayOffNotificationKind, t: MailTranslator): string {
  switch (kind) {
    case "day_off_locked":
      return t("notifications.mail.subject.dayOffLocked");
    case "day_off_proposed":
      return t("notifications.mail.subject.dayOffProposed");
    case "day_off_countered":
      return t("notifications.mail.subject.dayOffCountered");
    case "day_off_accepted":
      return t("notifications.mail.subject.dayOffAccepted");
    case "day_off_declined":
      return t("notifications.mail.subject.dayOffDeclined");
    case "day_off_reset":
      return t("notifications.mail.subject.dayOffReset");
    case "day_off_dropped":
      return t("notifications.mail.subject.dayOffDropped");
    case "day_off_reminder":
      return t("notifications.mail.subject.dayOffReminder");
  }
}

function leadOf(ctx: DayOffMailContext, t: MailTranslator, locale: string): string {
  const duty = day(ctx.dutyDate, locale);
  const date = ctx.date ? day(ctx.date, locale) : "";
  const dates = ctx.proposedDates.map((d) => day(d, locale)).join(", ");
  const holder = ctx.holderName;
  switch (ctx.kind) {
    case "day_off_locked":
      return t("notifications.mail.lead.dayOffLocked", { duty });
    case "day_off_proposed":
      return t("notifications.mail.lead.dayOffProposed", { holder, duty, dates });
    case "day_off_countered":
      return t("notifications.mail.lead.dayOffCountered", { duty, date });
    case "day_off_accepted":
      return t("notifications.mail.lead.dayOffAccepted", { duty, date });
    case "day_off_declined":
      return t("notifications.mail.lead.dayOffDeclined", { duty, date });
    case "day_off_reset":
      return t("notifications.mail.lead.dayOffReset", { duty });
    case "day_off_dropped":
      return t("notifications.mail.lead.dayOffDropped", { duty });
    case "day_off_reminder":
      return t("notifications.mail.lead.dayOffReminder", { holder, duty });
  }
}

const link = (href: string, text: string, style: string) =>
  `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(text)}</a>`;

export function renderDayOffMail(ctx: DayOffMailContext, t: MailTranslator, locale: string): { subject: string; html: string } {
  const subject = subjectOf(ctx.kind, t);
  const lines = [leadOf(ctx, t, locale)];
  if (ctx.reason) lines.push(t("notifications.mail.reason", { reason: ctx.reason }));
  if (ctx.note) lines.push(t("notifications.mail.note", { note: ctx.note }));
  const html = [
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">`,
    `<p style="font-size:16px;font-weight:600;margin:0 0 12px">${escapeHtml(subject)}</p>`,
    ...lines.map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`),
    `<p style="margin:20px 0">${link(
      `${ctx.appUrl}/swaps?tab=dayOffs`,
      t("notifications.mail.button"),
      "background:#2563eb;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block"
    )}</p>`,
    `<p style="margin:24px 0 0;font-size:12px">${link(
      `${ctx.appUrl}/swaps?settings=notifications`,
      t("notifications.mail.footer"),
      "color:#6b7280"
    )}</p>`,
    `</div>`,
  ].join("");
  return { subject, html };
}
