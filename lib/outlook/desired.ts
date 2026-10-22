// [fork] Sollzustand of the office@ event for one duty (spec 12.24). Pure: no database, no Graph.
import { createHash } from "node:crypto";
import { addDays } from "@/lib/rotation/dates";

/** Windows zone name Graph expects for Europe/Vienna; Exchange applies DST itself. */
export const GRAPH_TIME_ZONE = "W. Europe Standard Time";

export interface DutyForSync {
  shiftId: string;
  rotationId: string;
  date: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  title: string;
  holders: { email: string | null; name: string | null }[];
}

export interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}

export interface Attendee {
  address: string;
  name: string | null;
}

export interface DesiredEvent {
  subject: string;
  start: GraphDateTime;
  end: GraphDateTime;
  isAllDay: boolean;
  attendees: Attendee[];
}

const at = (date: string, time: string): GraphDateTime => ({ dateTime: `${date}T${time}:00`, timeZone: GRAPH_TIME_ZONE });

export function desiredEvent(duty: DutyForSync): DesiredEvent {
  const byAddress = new Map<string, Attendee>();
  for (const holder of duty.holders) {
    const address = holder.email?.trim().toLowerCase();
    if (address && !byAddress.has(address)) byAddress.set(address, { address, name: holder.name });
  }
  const attendees = [...byAddress.values()].sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0)); // plain compare: fingerprints must not depend on ICU

  if (duty.isAllDay) {
    return { subject: duty.title, start: at(duty.date, "00:00"), end: at(addDays(duty.date, 1), "00:00"), isAllDay: true, attendees };
  }
  // Spec 12.3: an end before the start means the duty runs past midnight.
  const endDate = duty.endTime < duty.startTime ? addDays(duty.date, 1) : duty.date;
  return { subject: duty.title, start: at(duty.date, duty.startTime), end: at(endDate, duty.endTime), isAllDay: false, attendees };
}

/** Covers what Outlook shows; names are left out so renaming a user does not re-send invitations. */
export function fingerprint(event: DesiredEvent): string {
  const canonical = JSON.stringify([
    event.subject,
    event.start.dateTime,
    event.end.dateTime,
    event.isAllDay,
    event.attendees.map((a) => a.address),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** Local start of a duty (the server runs in TZ=Europe/Vienna). */
export function dutyStartsAt(date: string, startTime: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = startTime.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}
