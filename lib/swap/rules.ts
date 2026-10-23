// Pure swap rules on plain data: whether an offer or an acceptance is allowed,
// which Plätze move, and how locks follow them. No DB access.
import { hasStarted, toDayNumber } from "@/lib/rotation/dates";
import type { SwapErrorCode, SwapStatus, SwapType } from "@/lib/swap/types";

export interface DutyTiming {
  shiftId: string;
  calendarId: string;
  date: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
}

/** A duty with the users currently holding its Plätze. */
export interface SlotView {
  duty: DutyTiming;
  holderIds: string[];
}

export interface SlotMove {
  shiftId: string;
  fromUserId: string;
  toUserId: string;
}

export interface LockRow {
  shiftId: string;
  userId: string;
  replacesUserId: string | null;
}

const DAY_MINUTES = 1440;
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** [start, end) in local wall-clock minutes since 1970-01-01; an end before the start runs into the next day. */
export function dutySpan(d: DutyTiming): [number, number] {
  const base = toDayNumber(d.date) * DAY_MINUTES;
  if (d.isAllDay) return [base, base + DAY_MINUTES];
  const start = base + toMinutes(d.startTime);
  let end = base + toMinutes(d.endTime);
  if (end <= start) end += DAY_MINUTES;
  return [start, end];
}

export function overlaps(a: DutyTiming, b: DutyTiming): boolean {
  const [aStart, aEnd] = dutySpan(a);
  const [bStart, bEnd] = dutySpan(b);
  return aStart < bEnd && bStart < aEnd;
}

const started = (d: DutyTiming, now: Date) => hasStarted(d.date, d.startTime, now);

/** Whether `incoming` would clash with any of `held`, ignoring the duty being handed away. */
function clashes(incoming: DutyTiming, held: DutyTiming[], handedAway: string | null): boolean {
  return held.some((d) => d.shiftId !== incoming.shiftId && d.shiftId !== handedAway && overlaps(d, incoming));
}

export interface OfferCheckInput {
  type: SwapType;
  offererId: string;
  targetUserId: string | null;
  offered: SlotView;
  requested: SlotView | null;
  hasOpenOffer: boolean;
  now: Date;
}

export function checkOffer(input: OfferCheckInput): SwapErrorCode | null {
  const { offered, requested } = input;
  if (!offered.holderIds.includes(input.offererId)) return "slotNotOwned";
  if (started(offered.duty, input.now)) return "alreadyStarted";
  if (input.targetUserId === input.offererId) return "invalid";
  if (input.targetUserId && offered.holderIds.includes(input.targetUserId)) return "alreadyOnDuty";
  if (input.type === "give" && requested) return "invalid";
  if (requested) {
    if (requested.duty.calendarId !== offered.duty.calendarId || requested.duty.shiftId === offered.duty.shiftId) {
      return "invalidShift";
    }
    if (started(requested.duty, input.now)) return "alreadyStarted";
    if (requested.holderIds.includes(input.offererId)) return "alreadyOnDuty";
    if (input.targetUserId && !requested.holderIds.includes(input.targetUserId)) return "slotNotOwned";
  }
  if (input.hasOpenOffer) return "duplicateOffer";
  return null;
}

export interface AcceptCheckInput {
  offer: {
    type: SwapType;
    status: SwapStatus;
    offeredByUserId: string;
    targetUserId: string | null;
    requestedShiftId: string | null;
  };
  acceptorId: string;
  offered: SlotView;
  /** exchange only: the duty the acceptor gives back */
  counter: SlotView | null;
  /** every duty the acceptor holds a Platz in */
  acceptorDuties: DutyTiming[];
  /** every duty the offerer holds a Platz in */
  offererDuties: DutyTiming[];
  now: Date;
}

export type AcceptCheck = { ok: true; moves: SlotMove[] } | { ok: false; error: SwapErrorCode };

export function checkAccept(input: AcceptCheckInput): AcceptCheck {
  const { offer, acceptorId, offered, counter, now } = input;
  const fail = (error: SwapErrorCode): AcceptCheck => ({ ok: false, error });
  const offererId = offer.offeredByUserId;

  if (offer.status !== "open") return fail("notOpen");
  if (acceptorId === offererId) return fail("ownOffer");
  if (offer.targetUserId && offer.targetUserId !== acceptorId) return fail("notTarget");
  if (!offered.holderIds.includes(offererId)) return fail("slotNotOwned");
  if (started(offered.duty, now)) return fail("alreadyStarted");
  if (offered.holderIds.includes(acceptorId)) return fail("alreadyOnDuty");

  const moves: SlotMove[] = [{ shiftId: offered.duty.shiftId, fromUserId: offererId, toUserId: acceptorId }];

  if (offer.type === "give") {
    if (counter) return fail("invalid");
  } else {
    if (!counter) return fail("invalid");
    const c = counter.duty;
    if (
      c.shiftId === offered.duty.shiftId ||
      c.calendarId !== offered.duty.calendarId ||
      (offer.requestedShiftId && offer.requestedShiftId !== c.shiftId)
    ) {
      return fail("invalidShift");
    }
    if (!counter.holderIds.includes(acceptorId)) return fail("slotNotOwned");
    if (started(c, now)) return fail("alreadyStarted");
    if (counter.holderIds.includes(offererId)) return fail("alreadyOnDuty");
    moves.push({ shiftId: c.shiftId, fromUserId: acceptorId, toUserId: offererId });
  }

  if (clashes(offered.duty, input.acceptorDuties, counter?.duty.shiftId ?? null)) return fail("doubleBooked");
  if (counter && clashes(counter.duty, input.offererDuties, offered.duty.shiftId)) return fail("doubleBooked");
  return { ok: true, moves };
}

/**
 * The lock a moved Platz ends up with. `existing` is the lock the Platz had
 * under its previous holder; the planned Teilnehmer survives repeated swaps,
 * and a Platz back with that Teilnehmer is no longer locked.
 */
export function nextLock(move: SlotMove, existing: LockRow | null): LockRow | null {
  const planned = existing?.replacesUserId ?? move.fromUserId;
  if (move.toUserId === planned) return null;
  return { shiftId: move.shiftId, userId: move.toUserId, replacesUserId: planned };
}

/**
 * Whether an open offer has ended by itself: its duty (or its concrete
 * counter duty) has begun, the offered Platz is no longer the offerer's, or
 * the concrete counter duty can no longer be handed over — the offerer holds
 * it already, or for a Direktanfrage it is no longer the target's.
 * `offered`/`requested` are null when the shift is no longer a duty.
 */
export function dueStatus(
  offererId: string,
  targetUserId: string | null,
  offered: SlotView | null,
  requested: SlotView | null,
  requestedShiftId: string | null,
  now: Date
): "expired" | "cancelled" | null {
  if (!offered) return "cancelled";
  if (started(offered.duty, now)) return "expired";
  if (!offered.holderIds.includes(offererId)) return "cancelled";
  if (requestedShiftId) {
    if (!requested) return "cancelled";
    if (started(requested.duty, now)) return "expired";
    if (requested.holderIds.includes(offererId)) return "cancelled";
    if (targetUserId && !requested.holderIds.includes(targetUserId)) return "cancelled";
  }
  return null;
}
