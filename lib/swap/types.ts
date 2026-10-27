// [fork] Swap board types shared by server and client; no DB imports here.
export type SwapType = "give" | "exchange" | "forced";
export type SwapStatus = "open" | "accepted" | "declined" | "withdrawn" | "expired" | "cancelled";
/** Ausgleich of a forced swap; null on other types and on a forced offer nobody took yet. */
export type CounterStatus = "pending" | "chosen" | "waived";

export type SwapErrorCode =
  | "notFound"
  | "forbidden"
  | "invalid"
  | "notDuty"
  | "invalidShift"
  | "notOpen"
  | "ownOffer"
  | "notTarget"
  | "slotNotOwned"
  | "alreadyStarted"
  | "alreadyOnDuty"
  | "doubleBooked"
  | "duplicateOffer"
  | "notDirect"
  | "notBroadcast"
  | "dutySlotSwapOnly"
  | "closedDuty"
  | "counterNotDue"
  | "outsideWindow";

export interface DutyInfo {
  shiftId: string;
  calendarId: string;
  date: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  title: string;
}

export interface Person {
  id: string;
  name: string | null;
}

export interface BoardEntry {
  id: string;
  type: SwapType;
  status: SwapStatus;
  calendarName: string;
  offered: DutyInfo;
  requested: DutyInfo | null;
  accepted: DutyInfo | null;
  offeredBy: Person;
  target: Person | null;
  acceptedBy: Person | null;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Board {
  calendars: { id: string; name: string }[];
  forMe: BoardEntry[];
  mine: BoardEntry[];
  hidden: BoardEntry[];
}

export interface DutyListEntry extends DutyInfo {
  holders: Person[];
  myOpenSwapId: string | null;
}

export interface CounterCandidatesResponse {
  duties: DutyInfo[];
  windowEnd: string;
}

export interface DutiesResponse {
  duties: DutyListEntry[];
  members: Person[];
}

export interface CalendarSwapState {
  dutyShiftIds: string[];
  openOfferShiftIds: string[];
  /** Eintragsvorlage per duty (Schließeinträge excluded), spec 12.32. */
  entryTemplates: Record<string, string>;
  /** Who offers which Platz, so the calendar marks only that holder's entry. */
  openOffers: { shiftId: string; userId: string }[];
}
