import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { enqueueSwapEvent } from "@/lib/notify/enqueue";
import { notificationOutbox } from "@/lib/notify/schema";
import { acceptOffer, createOffer, declineOffer, SwapServiceError } from "@/lib/swap/service";
import { now, seedDuties } from "@/lib/swap/__tests__/fixtures";

let s: Awaited<ReturnType<typeof seedDuties>>;
const give = (shiftId: string, targetUserId: string | null = null) => ({
  shiftId,
  type: "give" as const,
  targetUserId,
  requestedShiftId: null,
  note: null,
});
const outbox = (swapId: string) =>
  db
    .select({ kind: notificationOutbox.kind, actorUserId: notificationOutbox.actorUserId, status: notificationOutbox.status })
    .from(notificationOutbox)
    .where(eq(notificationOutbox.swapId, swapId))
    .all();
const total = () => db.select().from(notificationOutbox).all().length;

beforeEach(async () => {
  vi.stubEnv("OUTLOOK_ORGANIZER", "office@firma.at");
  vi.stubEnv("OUTLOOK_DRY_RUN", "true");
  s = await seedDuties();
});
afterEach(() => vi.unstubAllEnvs());

describe("enqueueSwapEvent via the swap service", () => {
  it("queues offer_to_all for an offer an alle and offer_to_me for a Direktanfrage", () => {
    const broadcast = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    const direct = createOffer(give(s.duty("2026-11-14"), s.m4), s.m2, now);
    expect(outbox(broadcast.id)).toEqual([{ kind: "offer_to_all", actorUserId: s.m0, status: "pending" }]);
    expect(outbox(direct.id)).toEqual([{ kind: "offer_to_me", actorUserId: s.m2, status: "pending" }]);
  });

  it("queues offer_accepted with the acceptor and offer_declined with the target as actor", () => {
    const taken = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    acceptOffer(taken.id, s.m2, null, now);
    expect(outbox(taken.id).map((r) => [r.kind, r.actorUserId])).toEqual([
      ["offer_to_all", s.m0],
      ["offer_accepted", s.m2],
    ]);

    const asked = createOffer(give(s.duty("2026-11-14"), s.m4), s.m2, now);
    declineOffer(asked.id, s.m4, now);
    expect(outbox(asked.id).map((r) => [r.kind, r.actorUserId])).toEqual([
      ["offer_to_me", s.m2],
      ["offer_declined", s.m4],
    ]);
  });

  it("writes nothing when the action fails", () => {
    const before = total();
    expect(() => createOffer(give(s.duty("2026-11-14")), s.m0, now)).toThrow(SwapServiceError);
    expect(total()).toBe(before);
  });

  it("rolls back with the surrounding transaction", () => {
    const swap = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    expect(() =>
      db.transaction((tx) => {
        enqueueSwapEvent(tx, "offer_accepted", swap, s.m2, now);
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(outbox(swap.id).map((r) => r.kind)).toEqual(["offer_to_all"]);
  });

  it("writes nothing without an Outlook configuration", () => {
    vi.unstubAllEnvs();
    const swap = createOffer(give(s.duty("2026-11-07")), s.m0, now);
    expect(outbox(swap.id)).toEqual([]);
  });
});
