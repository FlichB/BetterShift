// [fork] Sollzustand of the office@ events: one per Platz, one per Schließeintrag (spec 12.32). Pure: no database, no Graph.
import { createHash } from "node:crypto";
import { addDays } from "@/lib/rotation/dates";
import { entryTitle, holderDisplayName } from "@/lib/rotation/entry-title";
import type { RotationDutyKind } from "@/lib/rotation/types";

/** Windows zone name Graph expects for Europe/Vienna; Exchange applies DST itself. */
export const GRAPH_TIME_ZONE = "W. Europe Standard Time";

export interface PlaceHolder {
  userId: string;
  email: string | null;
  name: string | null;
}

export interface DutyForSync {
  shiftId: string;
  rotationId: string;
  kind: RotationDutyKind;
  date: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  title: string;
  /** Eintragsvorlage of the rotation. */
  entryTitle: string;
  holders: PlaceHolder[];
}

export interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}

export interface Attendee {
  address: string;
  name: string | null;
}

/** Lines of the event body besides the fixed text; part of the fingerprint. */
export interface EventDetails {
  time: string | null;
  partners: string[];
}

export interface DesiredEvent {
  subject: string;
  start: GraphDateTime;
  end: GraphDateTime;
  isAllDay: boolean;
  showAs: "free" | "busy";
  attendees: Attendee[];
  details: EventDetails;
}

/** One office@ event: a Platz of a duty, or a whole Schließeintrag (userId null). */
export interface PlaceEvent {
  key: string;
  shiftId: string;
  userId: string | null;
  rotationId: string;
  date: string;
  startTime: string;
  event: DesiredEvent;
}

const at = (date: string, time: string): GraphDateTime => ({ dateTime: `${date}T${time}:00`, timeZone: GRAPH_TIME_ZONE });

export const placeKey = (shiftId: string, userId: string | null): string => (userId ? `${shiftId}:${userId}` : shiftId);

const plainCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0); // fingerprints must not depend on ICU

function closureEvent(duty: DutyForSync): DesiredEvent {
  const details: EventDetails = { time: null, partners: [] };
  if (duty.isAllDay) {
    return { subject: duty.title, start: at(duty.date, "00:00"), end: at(addDays(duty.date, 1), "00:00"), isAllDay: true, showAs: "busy", attendees: [], details };
  }
  // Spec 12.3: an end at or before the start means the entry runs past midnight.
  const endDate = duty.endTime <= duty.startTime ? addDays(duty.date, 1) : duty.date;
  return { subject: duty.title, start: at(duty.date, duty.startTime), end: at(endDate, duty.endTime), isAllDay: false, showAs: "busy", attendees: [], details };
}

/** Spec 12.32: one all-day, free event per Platz with only its holder invited; a Schließeintrag stays one event. */
export function desiredEvents(duty: DutyForSync): PlaceEvent[] {
  const base = { shiftId: duty.shiftId, rotationId: duty.rotationId, date: duty.date, startTime: duty.startTime };
  if (duty.kind === "closed") return [{ ...base, key: placeKey(duty.shiftId, null), userId: null, event: closureEvent(duty) }];

  const time = duty.isAllDay ? null : `${duty.startTime}–${duty.endTime}`;
  const seen = new Set<string>();
  const result: PlaceEvent[] = [];
  for (const holder of duty.holders) {
    const address = holder.email?.trim().toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    const partners = duty.holders
      .filter((h) => h.userId !== holder.userId)
      .map((h) => holderDisplayName(h))
      .filter(Boolean)
      .sort(plainCompare);
    result.push({
      ...base,
      key: placeKey(duty.shiftId, holder.userId),
      userId: holder.userId,
      event: {
        subject: entryTitle(duty.entryTitle, holder, duty.title),
        start: at(duty.date, "00:00"),
        end: at(addDays(duty.date, 1), "00:00"),
        isAllDay: true,
        showAs: "free",
        attendees: [{ address, name: holder.name }],
        details: { time, partners },
      },
    });
  }
  return result;
}

/** Covers what Outlook shows; the invitee's own name is left out so renaming them does not re-send the invitation. */
export function fingerprint(event: DesiredEvent): string {
  const canonical = JSON.stringify([
    event.subject,
    event.start.dateTime,
    event.end.dateTime,
    event.isAllDay,
    event.showAs,
    event.attendees.map((a) => a.address),
    event.details.time,
    event.details.partners,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** Local start of a duty (the server runs in TZ=Europe/Vienna). */
export function dutyStartsAt(date: string, startTime: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = startTime.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}
