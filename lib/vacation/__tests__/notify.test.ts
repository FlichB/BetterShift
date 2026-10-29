// [fork] Urlaub mails (SPEC 12.43 point 10).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { setPreferences, getPreferences } from "@/lib/notify/preferences";
import { getMailTranslator } from "@/lib/notify/translator";
import { getOutlookConfig } from "@/lib/outlook/config";
import { dispatchVacationNotifications } from "@/lib/vacation/dispatch";
import { renderVacationMail } from "@/lib/vacation/render";
import { resolveVacationRecipients } from "@/lib/vacation/recipients";
import { vacationOutbox } from "@/lib/vacation/schema";
import { enterVacation, requestVacation } from "@/lib/vacation/service";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { FakeGraph } from "@/tests/helpers/fake-graph";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

beforeEach(() => {
  vi.stubEnv("OUTLOOK_ORGANIZER", "office@firma.at");
  vi.stubEnv("OUTLOOK_DRY_RUN", "true");
  db.delete(vacationOutbox).run();
});

describe("recipients", () => {
  it("sends requests to the Verwaltung and decisions to the person, honouring switches", async () => {
    const s = await seedDuties();
    const v = await requestVacation(s.m1, { startDate: "2026-12-01", endDate: "2026-12-02", note: null }, now);
    expect((await resolveVacationRecipients("vacation_requested", v, s.m1)).map((r) => r.id)).toEqual([s.team.ownerId]);
    expect((await resolveVacationRecipients("vacation_approved", v, s.team.ownerId)).map((r) => r.id)).toEqual([s.m1]);
    setPreferences(s.m1, { ...getPreferences(s.m1), myVacations: false });
    expect(await resolveVacationRecipients("vacation_approved", v, s.team.ownerId)).toEqual([]);
    expect(await resolveVacationRecipients("vacation_approved", v, s.m1)).toEqual([]); // never about one's own action
  });
});

describe("render", () => {
  it("names the range and the previous range", async () => {
    const { t, locale } = await getMailTranslator();
    const mail = renderVacationMail(
      { kind: "vacation_changed", holderName: "Mia", startDate: "2026-12-07", endDate: "2026-12-11", previousStart: "2026-12-01", previousEnd: "2026-12-04", note: null, appUrl: "https://app" },
      t,
      locale
    );
    expect(mail.subject).toBe("Urlaub geändert");
    expect(mail.html).toContain("07.12.2026");
    expect(mail.html).toContain("01.12.2026");
    expect(mail.html).toContain("https://app/swaps?tab=vacation");
  });
});

describe("dispatch", () => {
  it("sends pending rows and skips decided requests", async () => {
    const s = await seedDuties();
    await enterVacation(s.m2, { startDate: "2026-12-01", endDate: "2026-12-02", note: null }, s.team.ownerId, now);
    const graph = new FakeGraph();
    const result = await dispatchVacationNotifications(graph, getOutlookConfig()!, now);
    expect(result.sent).toBe(1);
    expect(db.select().from(vacationOutbox).all().every((r) => r.status === "sent")).toBe(true);
  });
});
