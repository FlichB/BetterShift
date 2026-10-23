// [fork] Mail and event texts (spec 12.27). Pure apart from the translator passed in.
// Translation keys stay literal string arguments of t() so scripts/i18n-checks.ts can see them.
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { getDateLocale } from "@/lib/locales";
import type { NotificationKind } from "@/lib/notify/schema";
import type { MailTranslator } from "@/lib/notify/translator";
import type { SwapType } from "@/lib/swap/types";

export interface MailDuty {
  date: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  title: string;
}

export interface MailContext {
  kind: NotificationKind;
  type: SwapType;
  offered: MailDuty;
  requested: MailDuty | null;
  accepted: MailDuty | null;
  offeredByName: string;
  actorName: string;
  note: string | null;
  appUrl: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDuty(duty: MailDuty, t: MailTranslator, locale: string): string {
  const day = format(parseLocalDate(duty.date), "EEEE, P", { locale: getDateLocale(locale) });
  return duty.isAllDay ? `${day} (${t("notifications.mail.allDay")})` : `${day}, ${duty.startTime}–${duty.endTime}`;
}

function subjectOf(kind: NotificationKind, t: MailTranslator, duty: string): string {
  switch (kind) {
    case "offer_to_all":
      return t("notifications.mail.subject.offerToAll", { duty });
    case "offer_to_me":
      return t("notifications.mail.subject.offerToMe", { duty });
    case "offer_accepted":
      return t("notifications.mail.subject.offerAccepted", { duty });
    case "offer_declined":
      return t("notifications.mail.subject.offerDeclined", { duty });
  }
}

function leadOf(ctx: MailContext, t: MailTranslator, duty: string): string {
  switch (ctx.kind) {
    case "offer_to_all":
      return t("notifications.mail.lead.offerToAll", { name: ctx.offeredByName, duty });
    case "offer_to_me":
      return t("notifications.mail.lead.offerToMe", { name: ctx.offeredByName, duty });
    case "offer_accepted":
      return t("notifications.mail.lead.offerAccepted", { name: ctx.actorName, duty });
    case "offer_declined":
      return t("notifications.mail.lead.offerDeclined", { name: ctx.actorName, duty });
  }
}

function kindOf(ctx: MailContext, t: MailTranslator, locale: string): string {
  if (ctx.type === "give") return t("notifications.mail.kind.give");
  return ctx.requested
    ? t("notifications.mail.kind.exchangeFor", { duty: formatDuty(ctx.requested, t, locale) })
    : t("notifications.mail.kind.exchangeAny");
}

const link = (href: string, text: string, style: string) =>
  `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(text)}</a>`;

export function renderMail(ctx: MailContext, t: MailTranslator, locale: string): { subject: string; html: string } {
  const duty = formatDuty(ctx.offered, t, locale);
  const isOffer = ctx.kind === "offer_to_all" || ctx.kind === "offer_to_me";
  const lines = [leadOf(ctx, t, duty)];
  if (isOffer) lines.push(kindOf(ctx, t, locale));
  if (ctx.kind === "offer_accepted" && ctx.accepted) {
    lines.push(t("notifications.mail.youGet", { duty: formatDuty(ctx.accepted, t, locale) }));
  }
  if (isOffer && ctx.note) lines.push(t("notifications.mail.note", { note: ctx.note }));

  const html = [
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">`,
    `<p style="font-size:16px;font-weight:600;margin:0 0 12px">${escapeHtml(ctx.offered.title)}</p>`,
    ...lines.map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`),
    `<p style="margin:20px 0">${link(
      `${ctx.appUrl}/swaps`,
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
  return { subject: subjectOf(ctx.kind, t, duty), html };
}

export function renderEventBody(t: MailTranslator, appUrl: string): string {
  return `<p>${escapeHtml(t("outlook.eventBody"))}</p><p>${link(`${appUrl}/swaps`, t("notifications.mail.button"), "")}</p>`;
}
