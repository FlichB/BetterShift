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
const offer = (shiftId: string, targetUserId: string | null = null) => ({
  shiftId,
  type: "exchange" as const,
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
    const swap = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    expect(await dispatch()).toMatchObject({ sent: 1, skipped: 0, failed: 0, authError: null });
    const [mail] = graph.mails;
    expect(mail.to).toEqual(["office@firma.at"]);
    // m0 offers and m1 co-holds the duty: neither can take it over.
    const expected = [...s.team.memberIds.filter((id) => id !== s.m0 && id !== s.m1), s.team.ownerId].map(emailOf).sort();
    expect([...mail.bcc].sort()).toEqual(expected);
    expect(mail.subject).toContain("Dienst angeboten");
    expect(statusOf(swap.id)).toEqual([{ kind: "offer_to_all", status: "sent" }]);
  });

  it("respects switched-off preferences", async () => {
    setPreferences(s.m2, { offersToAll: false, offersToMe: true, myOffers: true, myDayOffs: true, dayOffRequests: true, myVacations: true, vacationRequests: true });
    createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    await dispatch();
    expect(graph.mails[0].bcc).not.toContain(emailOf(s.m2));
    expect(graph.mails[0].bcc.length).toBeGreaterThan(0);
  });

  it("does not address a co-holder of the offered duty", async () => {
    createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    await dispatch();
    expect(graph.mails[0].bcc).not.toContain(emailOf(s.m1));
  });

  it("addresses a Direktanfrage and an acceptance to one person directly", async () => {
    const direct = createOffer(offer(s.duty("2026-11-14"), s.m4), s.m2, now);
    await dispatch();
    expect(graph.mails[0]).toMatchObject({ to: [emailOf(s.m4)], bcc: [] });

    acceptOffer(direct.id, s.m4, s.duty("2026-11-21"), now);
    await dispatch();
    expect(graph.mails[1]).toMatchObject({ to: [emailOf(s.m2)], bcc: [] });
    expect(graph.mails[1].subject).toContain("angenommen");
  });

  it("skips offers that are no longer open and events without recipients", async () => {
    const withdrawn = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    withdrawOffer(withdrawn.id, s.m0, now);
    const lonely = createOffer(offer(s.duty("2026-11-14"), s.m4), s.m2, now);
    setPreferences(s.m4, { offersToAll: true, offersToMe: false, myOffers: true, myDayOffs: true, dayOffRequests: true, myVacations: true, vacationRequests: true });
    expect(await dispatch()).toMatchObject({ sent: 0, skipped: 2 });
    expect(statusOf(withdrawn.id)).toEqual([{ kind: "offer_to_all", status: "skipped" }]);
    expect(statusOf(lonely.id)).toEqual([{ kind: "offer_to_me", status: "skipped" }]);
    expect(graph.mails).toEqual([]);
  });

  it("retries with backoff and gives up after the last attempt", async () => {
    const swap = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
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

  it("honours Retry-After when Graph throttles a mail", async () => {
    const swap = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    graph.failures.push(new GraphError(429, "429 TooManyRequests", 120_000));
    await dispatch();
    const row = db.select().from(notificationOutbox).where(eq(notificationOutbox.swapId, swap.id)).get()!;
    expect(row.nextAttemptAt).toEqual(new Date(now.getTime() + 120_000));
  });

  it("treats a non-Graph exception as a failed attempt and keeps working through the queue", async () => {
    const first = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    const second = createOffer(offer(s.duty("2026-11-14"), s.m4), s.m2, now);
    const spy = vi.spyOn(graph, "sendMail").mockRejectedValueOnce(new TypeError("boom"));
    expect(await dispatch()).toMatchObject({ sent: 1, authError: null });
    spy.mockRestore();
    const row = db.select().from(notificationOutbox).where(eq(notificationOutbox.swapId, first.id)).get()!;
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "boom" });
    expect(statusOf(second.id)).toEqual([{ kind: "offer_to_me", status: "sent" }]);
  });

  it("stops at an auth error and keeps the event pending", async () => {
    const swap = createOffer(offer(s.duty("2026-11-07")), s.m0, now);
    graph.failures.push(new GraphError(401, "401 InvalidAuthenticationToken"));
    expect(await dispatch()).toMatchObject({ sent: 0, authError: "401 InvalidAuthenticationToken" });
    expect(statusOf(swap.id)).toEqual([{ kind: "offer_to_all", status: "pending" }]);
  });
});
