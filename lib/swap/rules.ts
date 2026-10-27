// Pure swap rules on plain data: whether an offer or an acceptance is allowed,
// which Plätze move, and how locks follow them. No DB access.
import { addMonths } from "date-fns";
import { formatDateToLocal, parseLocalDate } from "@/lib/date-utils";
import { hasStarted, toDayNumber } from "@/lib/rotation/dates";
import type { CounterStatus, SwapErrorCode, SwapStatus, SwapType } from "@/lib/swap/types";

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

/** A forced swap stays possible for the whole day of the duty (spec D9). */
const dayPassed = (d: DutyTiming, now: Date) => d.date < formatDateToLocal(now);

export const COUNTER_WINDOW_MONTHS = 3;

/** Last day of the Ausgleichsfenster: the taken-over duty's date plus three months (spec D6). */
export function counterWindowEnd(dutyDate: string): string {
  return formatDateToLocal(addMonths(parseLocalDate(dutyDate), COUNTER_WINDOW_MONTHS));
}

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
  // Only exchanges can be offered (spec D1); a forced swap goes through checkForce.
  if (input.type !== "exchange") return "invalid";
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
  const ended = offer.type === "forced" ? dayPassed(offered.duty, now) : started(offered.duty, now);
  if (ended) return fail("alreadyStarted");
  if (offered.holderIds.includes(acceptorId)) return fail("alreadyOnDuty");

  const moves: SlotMove[] = [{ shiftId: offered.duty.shiftId, fromUserId: offererId, toUserId: acceptorId }];

  if (offer.type !== "exchange") {
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

export interface ForceCheckInput {
  absentId: string;
  /** null = offen an alle: nothing moves until someone takes it over */
  substituteId: string | null;
  offered: SlotView;
  substituteDuties: DutyTiming[];
  now: Date;
}

export function checkForce(input: ForceCheckInput): AcceptCheck {
  const { offered, absentId, substituteId, now } = input;
  const fail = (error: SwapErrorCode): AcceptCheck => ({ ok: false, error });
  if (!offered.holderIds.includes(absentId)) return fail("slotNotOwned");
  if (dayPassed(offered.duty, now)) return fail("alreadyStarted");
  if (!substituteId) return { ok: true, moves: [] };
  if (substituteId === absentId) return fail("invalid");
  if (offered.holderIds.includes(substituteId)) return fail("alreadyOnDuty");
  if (clashes(offered.duty, input.substituteDuties, null)) return fail("doubleBooked");
  return { ok: true, moves: [{ shiftId: offered.duty.shiftId, fromUserId: absentId, toUserId: substituteId }] };
}

export interface CounterOffer {
  type: SwapType;
  counterStatus: CounterStatus | null;
  counterWindowEnd: string | null;
  offeredByUserId: string;
  acceptedByUserId: string | null;
}

export interface CounterCheckInput {
  offer: CounterOffer;
  /** the duty the Einspringer took over */
  offered: { shiftId: string; calendarId: string };
  chosen: SlotView;
  /** every duty the absent user holds a Platz in */
  absentDuties: DutyTiming[];
  now: Date;
}

/** Whether the Einspringer may hand `chosen` to the absent user as Ausgleich (spec D6). */
export function checkCounterChoice(input: CounterCheckInput): AcceptCheck {
  const { offer, chosen, now } = input;
  const fail = (error: SwapErrorCode): AcceptCheck => ({ ok: false, error });
  const substituteId = offer.acceptedByUserId;
  if (offer.type !== "forced" || offer.counterStatus !== "pending" || !substituteId || !offer.counterWindowEnd) {
    return fail("counterNotDue");
  }
  const c = chosen.duty;
  if (c.shiftId === input.offered.shiftId || c.calendarId !== input.offered.calendarId) return fail("invalidShift");
  if (!chosen.holderIds.includes(substituteId)) return fail("slotNotOwned");
  if (started(c, now)) return fail("alreadyStarted");
  if (c.date > offer.counterWindowEnd) return fail("outsideWindow");
  if (chosen.holderIds.includes(offer.offeredByUserId)) return fail("alreadyOnDuty");
  if (clashes(c, input.absentDuties, null)) return fail("doubleBooked");
  return { ok: true, moves: [{ shiftId: c.shiftId, fromUserId: substituteId, toUserId: offer.offeredByUserId }] };
}

/** The duties checkCounterChoice would accept, so the selection list and the check never drift apart. */
export function counterCandidates(input: Omit<CounterCheckInput, "chosen"> & { slots: SlotView[] }): DutyTiming[] {
  const { slots, ...rest } = input;
  return slots
    .filter((chosen) => checkCounterChoice({ ...rest, chosen }).ok)
    .map((s) => s.duty)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

/** dueStatus for an open forced offer: it ends after the day of the duty, not at its start (spec D9). */
export function forcedDueStatus(absentId: string, offered: SlotView | null, now: Date): "expired" | "cancelled" | null {
  if (!offered) return "cancelled";
  if (dayPassed(offered.duty, now)) return "expired";
  if (!offered.holderIds.includes(absentId)) return "cancelled";
  return null;
}
