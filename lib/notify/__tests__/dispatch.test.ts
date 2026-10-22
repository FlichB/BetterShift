import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auditLogs, user } from "@/lib/db/schema";
import { dispatchNotifications, MAX_MAIL_ATTEMPTS } from "@/lib/notify/dispatch";
import { setPreferences } from "@/lib/notify/preferences";
import { notificationOutbox } from "@/lib/notify/schema";
import { getOutlookConfig } from "@/lib/outlook/config";
import { GraphError } from "@/lib/outlook/graph-client";
import { acceptOffer, createOffer, withdrawOffer } from "@/lib/swap/service";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";
import { FakeGraph } from "@/tests/helpers/fake-graph";

let s: Awaited<ReturnType<typeof seedDuties>>;
let graph: FakeGraph;
const give = (shiftId: string, targetUserId: string | null = null) => ({
  shiftId,
  type: "give" as const,
  targetUserId,
  requestedShiftId: null,
  note: null,
});
const emailOf = (id: string) => db.select({ email: user.email }).from(user).where(eq(user.id, id)).get()!.email;
const dispatch = (at: Date = now) => dispatchNotifications(graph, getOutlookConfig()!, at);
const statusOf = (swapId: string) =>
  db.select({ kind: notificationOutbox.kind, status: notificationOutbox.status }).from(notificationOutbox).where(eq(notificationOutbox.swapId, swapId)).all();

beforeEach(async () => {
  vi.stubEnv("OUTLOOK_ORGANIZER", "office@firma.at");
  vi.stubEnv("OUTLOOK_DRY_RUN", "true");
  // Tests in this file share one database: clear what earlier tests queued.
  db.delete(notificationOutbox).run();
  s = await seedDuties();
  graph = new FakeGraph();
});
afterEach(() => vi.unstubAllEnvs());

describe("dispatchNotifications", () => {
  it("sends an offer an alle in BCC to everyone who may swap, except the offerer", async () => {
    const swap = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    expect(await dispatch()).toMatchObject({ sent: 1, skipped: 0, failed: 0, authError: null });
    const [mail] = graph.mails;
    expect(mail.to).toEqual(["office@firma.at"]);
    const expected = [...s.team.memberIds.filter((id) => id !== s.m0), s.team.ownerId].map(emailOf).sort();
    expect([...mail.bcc].sort()).toEqual(expected);
    expect(mail.subject).toContain("Dienst angeboten");
    expect(statusOf(swap.id)).toEqual([{ kind: "offer_to_all", status: "sent" }]);
  });

  it("respects switched-off preferences", async () => {
    setPreferences(s.m1, { offersToAll: false, offersToMe: true, myOffers: true });
    createOffer(give(s.duty("2026-11-07")), s.m0, now);
    await dispatch();
    expect(graph.mails[0].bcc).not.toContain(emailOf(s.m1));
  });

  it("addresses a Direktanfrage and an acceptance to one person directly", async () => {
    const direct = createOffer(give(s.duty("2026-11-14"), s.m4), s.m2, now);
    await dispatch();
    expect(graph.mails[0]).toMatchObject({ to: [emailOf(s.m4)], bcc: [] });

    acceptOffer(direct.id, s.m4, null, now);
    await dispatch();
    expect(graph.mails[1]).toMatchObject({ to: [emailOf(s.m2)], bcc: [] });
    expect(graph.mails[1].subject).toContain("angenommen");
  });

  it("skips offers that are no longer open and events without recipients", async () => {
    const withdrawn = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    withdrawOffer(withdrawn.id, s.m0, now);
    const lonely = createOffer(give(s.duty("2026-11-14"), s.m4), s.m2, now);
    setPreferences(s.m4, { offersToAll: true, offersToMe: false, myOffers: true });
    expect(await dispatch()).toMatchObject({ sent: 0, skipped: 2 });
    expect(statusOf(withdrawn.id)).toEqual([{ kind: "offer_to_all", status: "skipped" }]);
    expect(statusOf(lonely.id)).toEqual([{ kind: "offer_to_me", status: "skipped" }]);
    expect(graph.mails).toEqual([]);
  });

  it("retries with backoff and gives up after the last attempt", async () => {
    const swap = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    graph.failures.push(new Error("smtp down"));
    await dispatch();
    const row = db.select().from(notificationOutbox).where(eq(notificationOutbox.swapId, swap.id)).get()!;
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "smtp down" });
    expect(row.nextAttemptAt).toEqual(new Date(now.getTime() + 60_000));

    db.update(notificationOutbox).set({ attempts: MAX_MAIL_ATTEMPTS - 1, nextAttemptAt: null }).where(eq(notificationOutbox.id, row.id)).run();
    graph.failures.push(new Error("smtp down"));
    expect(await dispatch()).toMatchObject({ failed: 1 });
    expect(statusOf(swap.id)).toEqual([{ kind: "offer_to_all", status: "failed" }]);
    expect(db.select().from(auditLogs).where(eq(auditLogs.action, "notification.failed")).all().length).toBeGreaterThan(0);
  });

  it("stops at an auth error and keeps the event pending", async () => {
    const swap = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    graph.failures.push(new GraphError(401, "401 InvalidAuthenticationToken"));
    expect(await dispatch()).toMatchObject({ sent: 0, authError: "401 InvalidAuthenticationToken" });
    expect(statusOf(swap.id)).toEqual([{ kind: "offer_to_all", status: "pending" }]);
  });
});
