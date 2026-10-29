// [fork] Urlaub mail texts. Pure apart from the translator passed in.
// Translation keys stay literal string arguments of t() so scripts/i18n-checks.ts can see them.
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { getDateLocale } from "@/lib/locales";
import { escapeHtml } from "@/lib/notify/render";
import type { MailTranslator } from "@/lib/notify/translator";
import type { VacationNotificationKind } from "@/lib/vacation/types";

export interface VacationMailContext {
  kind: VacationNotificationKind;
  holderName: string;
  startDate: string;
  endDate: string;
  previousStart: string | null;
  previousEnd: string | null;
  note: string | null;
  appUrl: string;
}

const day = (date: string, locale: string) => format(parseLocalDate(date), "EEEE, P", { locale: getDateLocale(locale) });

function subjectOf(kind: VacationNotificationKind, t: MailTranslator): string {
  switch (kind) {
    case "vacation_requested":
      return t("notifications.mail.subject.vacationRequested");
    case "vacation_change_requested":
      return t("notifications.mail.subject.vacationChangeRequested");
    case "vacation_approved":
      return t("notifications.mail.subject.vacationApproved");
    case "vacation_rejected":
      return t("notifications.mail.subject.vacationRejected");
    case "vacation_change_approved":
      return t("notifications.mail.subject.vacationChangeApproved");
    case "vacation_change_rejected":
      return t("notifications.mail.subject.vacationChangeRejected");
    case "vacation_entered":
      return t("notifications.mail.subject.vacationEntered");
    case "vacation_changed":
      return t("notifications.mail.subject.vacationChanged");
    case "vacation_cancelled":
      return t("notifications.mail.subject.vacationCancelled");
  }
}

function leadOf(ctx: VacationMailContext, t: MailTranslator, locale: string): string {
  const from = day(ctx.startDate, locale);
  const to = day(ctx.endDate, locale);
  const previous = ctx.previousStart && ctx.previousEnd ? t("notifications.mail.vacationRange", { from: day(ctx.previousStart, locale), to: day(ctx.previousEnd, locale) }) : "";
  const holder = ctx.holderName;
  switch (ctx.kind) {
    case "vacation_requested":
      return t("notifications.mail.lead.vacationRequested", { holder, from, to });
    case "vacation_change_requested":
      return t("notifications.mail.lead.vacationChangeRequested", { holder, from, to });
    case "vacation_approved":
      return t("notifications.mail.lead.vacationApproved", { from, to });
    case "vacation_rejected":
      return t("notifications.mail.lead.vacationRejected", { from, to });
    case "vacation_change_approved":
      return t("notifications.mail.lead.vacationChangeApproved", { from, to, previous });
    case "vacation_change_rejected":
      return t("notifications.mail.lead.vacationChangeRejected", { from, to });
    case "vacation_entered":
      return t("notifications.mail.lead.vacationEntered", { from, to });
    case "vacation_changed":
      return t("notifications.mail.lead.vacationChanged", { from, to, previous });
    case "vacation_cancelled":
      return t("notifications.mail.lead.vacationCancelled", { from, to });
  }
}

const link = (href: string, text: string, style: string) => `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(text)}</a>`;

export function renderVacationMail(ctx: VacationMailContext, t: MailTranslator, locale: string): { subject: string; html: string } {
  const subject = subjectOf(ctx.kind, t);
  const lines = [leadOf(ctx, t, locale)];
  if (ctx.note) lines.push(t("notifications.mail.note", { note: ctx.note }));
  const html = [
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">`,
    `<p style="font-size:16px;font-weight:600;margin:0 0 12px">${escapeHtml(subject)}</p>`,
    ...lines.map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`),
    `<p style="margin:20px 0">${link(
      `${ctx.appUrl}/swaps?tab=vacation`,
      t("notifications.mail.button"),
      "background:#2563eb;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block"
    )}</p>`,
    `<p style="margin:24px 0 0;font-size:12px">${link(`${ctx.appUrl}/swaps?settings=notifications`, t("notifications.mail.footer"), "color:#6b7280")}</p>`,
    `</div>`,
  ].join("");
  return { subject, html };
}
