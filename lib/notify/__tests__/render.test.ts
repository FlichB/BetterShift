import { describe, expect, it } from "vitest";
import { escapeHtml, formatDuty, renderEventBody, renderMail, type MailContext } from "@/lib/notify/render";
import { getMailTranslator } from "@/lib/notify/translator";

const duty = { date: "2026-11-07", startTime: "09:30", endTime: "15:00", isAllDay: false, title: "Samstagsdienst" };
const ctx = (overrides: Partial<MailContext> = {}): MailContext => ({
  kind: "offer_to_all",
  type: "give",
  offered: duty,
  requested: null,
  accepted: null,
  offeredByName: "Anna",
  actorName: "Anna",
  note: null,
  appUrl: "https://shift.firma.at",
  ...overrides,
});

describe("render", async () => {
  const { t, locale } = await getMailTranslator(); // vitest.config.mts pins DEFAULT_LOCALE=de

  it("formats a duty with weekday, date and time", () => {
    expect(formatDuty(duty, t, locale)).toBe("Samstag, 07.11.2026, 09:30–15:00");
    expect(formatDuty({ ...duty, isAllDay: true }, t, locale)).toBe("Samstag, 07.11.2026 (ganztägig)");
  });

  it("renders all four kinds", () => {
    expect(renderMail(ctx(), t, locale).subject).toBe("Dienst angeboten: Samstag, 07.11.2026, 09:30–15:00");
    expect(renderMail(ctx({ kind: "offer_to_me" }), t, locale).subject).toContain("Anfrage an dich");
    const accepted = renderMail(
      ctx({ kind: "offer_accepted", type: "exchange", actorName: "Berta", accepted: { ...duty, date: "2026-11-14" } }),
      t,
      locale
    );
    expect(accepted.subject).toContain("angenommen");
    expect(accepted.html).toContain("Berta hat dein Angebot");
    expect(accepted.html).toContain("Samstag, 14.11.2026");
    expect(renderMail(ctx({ kind: "offer_declined", actorName: "Berta" }), t, locale).html).toContain("Berta hat deine Anfrage");
  });

  it("describes the swap kind and the note only for offers", () => {
    const exchange = renderMail(ctx({ type: "exchange", requested: { ...duty, date: "2026-12-05" }, note: "Urlaub" }), t, locale);
    expect(exchange.html).toContain("Tausch gegen den Dienst am Samstag, 05.12.2026");
    expect(exchange.html).toContain("Notiz: Urlaub");
    expect(renderMail(ctx({ kind: "offer_accepted", note: "Urlaub" }), t, locale).html).not.toContain("Urlaub");
  });

  it("escapes user content and links to the board and the settings", () => {
    const html = renderMail(ctx({ offeredByName: "<b>Eve</b>", note: `"><script>x</script>` }), t, locale).html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
    expect(html).toContain('href="https://shift.firma.at/swaps"');
    expect(html).toContain('href="https://shift.firma.at/swaps?settings=notifications"');
    expect(escapeHtml(`a&b<'"`)).toBe("a&amp;b&lt;&#39;&quot;");
  });

  it("renders the event body with a link", () => {
    expect(renderEventBody(t, "https://shift.firma.at")).toContain('href="https://shift.firma.at/swaps"');
  });

  it("lists duty time and partners before the fixed text, escaped", () => {
    const html = renderEventBody(t, "https://app.example", { time: "09:30–15:00", partners: ["Anna <B>"] });
    expect(html).toContain("Dienstzeit: 09:30–15:00");
    expect(html).toContain("Mit: Anna &lt;B&gt;");
    expect(html.indexOf("Dienstzeit")).toBeLessThan(html.indexOf("Tauschbörse"));
  });
});
