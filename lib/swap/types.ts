// [fork] Swap board types shared by server and client; no DB imports here.
export type SwapType = "give" | "exchange";
export type SwapStatus = "open" | "accepted" | "declined" | "withdrawn" | "expired" | "cancelled";

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
  | "closedDuty";

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

export interface DutiesResponse {
  duties: DutyListEntry[];
  members: Person[];
}

export interface CalendarSwapState {
  dutyShiftIds: string[];
  openOfferShiftIds: string[];
}
