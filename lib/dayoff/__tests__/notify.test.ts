// [fork] Dienstfrei mails: recipients, rendering, dispatch, reminders.
import { and, eq, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { dispatchDayOffNotifications } from "@/lib/dayoff/dispatch";
import { renderDayOffMail } from "@/lib/dayoff/render";
import { resolveDayOffRecipients } from "@/lib/dayoff/recipients";
import { dayOffOutbox, dayOffProposals, dayOffs } from "@/lib/dayoff/schema";
import { lockDayOff, proposeDates, reconcileRotation, sendReminders } from "@/lib/dayoff/service";
import { setPreferences } from "@/lib/notify/preferences";
import { getMailTranslator } from "@/lib/notify/translator";
import { getOutlookConfig } from "@/lib/outlook/config";
import { rotations } from "@/lib/rotation/schema";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { FakeGraph } from "@/tests/helpers/fake-graph";

async function setup() {
  vi.stubEnv("OUTLOOK_ORGANIZER", "office@firma.at");
  vi.stubEnv("OUTLOOK_DRY_RUN", "true");
  db.delete(dayOffOutbox).run();
  const s = await seedDuties();
  db.update(rotations).set({ dayOffEnabled: true }).where(eq(rotations.id, s.rotation.id)).run();
  db.transaction((tx) => reconcileRotation(tx, s.rotation.id, now));
  db.delete(dayOffOutbox).run();
  const of = (date: string, userId: string) =>
    db.select().from(dayOffs).where(and(eq(dayOffs.shiftId, s.duty(date)), eq(dayOffs.userId, userId))).get()!;
  return { ...s, of };
}
const emailOf = (id: string) => db.select({ email: user.email }).from(user).where(eq(user.id, id)).get()!.email;
const outbox = () => db.select().from(dayOffOutbox).all();

afterEach(() => vi.unstubAllEnvs());

describe("Dienstfrei mails", () => {
  it("lock enqueues one holder mail; recipients are the holder unless switched off", async () => {
    const s = await setup();
    const row = s.of("2026-11-07", s.m0);
    lockDayOff(row.id, "Inventur", s.team.ownerId, now);
    expect(outbox()).toMatchObject([{ kind: "day_off_locked", audience: "holder" }]);
    const calendarId = s.team.calendarId;
    expect((await resolveDayOffRecipients("holder", row, calendarId, s.team.ownerId)).map((r) => r.id)).toEqual([s.m0]);
    setPreferences(s.m0, { offersToAll: true, offersToMe: true, myOffers: true, myDayOffs: false, dayOffRequests: true });
    expect(await resolveDayOffRecipients("holder", row, calendarId, s.team.ownerId)).toEqual([]);
  });

  it("proposals go to the managers, never to the actor", async () => {
    const s = await setup();
    const row = s.of("2026-11-07", s.m0);
    lockDayOff(row.id, null, s.team.ownerId, now);
    proposeDates(row.id, ["2026-11-18"], s.m0, now);
    expect(outbox().map((o) => [o.kind, o.audience])).toContainEqual(["day_off_proposed", "managers"]);
    const ids = (await resolveDayOffRecipients("managers", row, s.team.calendarId, s.m0)).map((r) => r.id);
    expect(ids).toContain(s.team.ownerId);
    expect(ids).not.toContain(s.m0);
    const own = await resolveDayOffRecipients("managers", row, s.team.calendarId, s.team.ownerId);
    expect(own.map((r) => r.id)).not.toContain(s.team.ownerId);
  });

  it("sends one reminder per Dienstfrei after three days, once", async () => {
    const s = await setup();
    const row = s.of("2026-11-07", s.m0);
    lockDayOff(row.id, null, s.team.ownerId, now);
    // The database is shared across this file: earlier tests left open proposals behind.
    db.delete(dayOffProposals).where(ne(dayOffProposals.dayOffId, row.id)).run();
    proposeDates(row.id, ["2026-11-18", "2026-11-19"], s.m0, now);
    db.delete(dayOffOutbox).run();
    expect(sendReminders(new Date(now.getTime() + 2 * 86_400_000))).toBe(0);
    const later = new Date(now.getTime() + 3 * 86_400_000);
    expect(sendReminders(later)).toBe(1);
    expect(outbox()).toMatchObject([{ kind: "day_off_reminder", audience: "managers", dayOffId: row.id }]);
    expect(sendReminders(later)).toBe(0);
    expect(outbox()).toHaveLength(1);
    expect(db.select().from(dayOffProposals).where(eq(dayOffProposals.dayOffId, row.id)).all().every((p) => p.remindedAt)).toBe(true);
  });

  it("renders the proposal mail with holder and dates", async () => {
    const { t, locale } = await getMailTranslator();
    const mail = renderDayOffMail(
      { kind: "day_off_proposed", holderName: "Anna", dutyDate: "2026-11-07", date: null, proposedDates: ["2026-11-18", "2026-11-19"], reason: null, note: null, appUrl: "https://x.at" },
      t,
      locale
    );
    expect(mail.subject).toBe("Terminvorschläge für Dienstfrei");
    expect(mail.html).toContain("Anna");
    expect(mail.html).toContain("18.11.2026");
    expect(mail.html).toContain("19.11.2026");
    expect(mail.html).toContain("https://x.at/swaps?tab=dayOffs");
  });

  it("dispatches pending mails through Graph and skips stale ones", async () => {
    const s = await setup();
    const row = s.of("2026-11-07", s.m0);
    lockDayOff(row.id, "Inventur", s.team.ownerId, now);
    const graph = new FakeGraph();
    expect(await dispatchDayOffNotifications(graph, getOutlookConfig()!, now)).toMatchObject({ sent: 1, skipped: 0, failed: 0 });
    expect(graph.mails[0]).toMatchObject({ to: [emailOf(s.m0)], bcc: [] });
    expect(outbox()[0].status).toBe("sent");

    // A lock mail for a row that is no longer locked is skipped.
    db.update(dayOffs).set({ status: "standard" }).where(eq(dayOffs.id, row.id)).run();
    db.insert(dayOffOutbox).values({ kind: "day_off_locked", dayOffId: row.id, audience: "holder", actorUserId: null, createdAt: now }).run();
    expect(await dispatchDayOffNotifications(graph, getOutlookConfig()!, now)).toMatchObject({ sent: 0, skipped: 1 });
  });
});
