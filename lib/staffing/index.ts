// [fork] Mindestbesetzung an Werktagen (SPEC 12.44, design docs/superpowers/specs/2026-10-28-mindestbesetzung-design.md).
// Pure: no database. Counts who is abwesend per rotation scope and day.
import { isoWeekday, toDayNumber } from "@/lib/rotation/dates";
import type { DateRange } from "@/lib/vacation/types";

/** One rotation with a Mindestbesetzung: its Teilnehmer and Schließtage. */
export interface StaffingScope {
  rotationId: string;
  rotationName: string;
  minimum: number;
  participants: readonly string[];
  closed: ReadonlySet<string>;
}

/** A Werktag on which fewer than `minimum` Teilnehmer would be present. */
export interface StaffingGap {
  rotationId: string;
  rotationName: string;
  date: string;
  present: number;
  minimum: number;
}

export interface PlacedDayOff {
  id: string;
  userId: string;
  date: string;
}

const isWerktag = (scope: StaffingScope, date: string) => isoWeekday(toDayNumber(date)) <= 5 && !scope.closed.has(date);

export class StaffingIndex {
  private readonly dayOffs = new Map<string, { userId: string; date: string }>();
  private readonly ranges: Map<string, readonly DateRange[]>;

  constructor(
    private readonly scopes: readonly StaffingScope[],
    vacations: ReadonlyMap<string, readonly DateRange[]>,
    dayOffs: readonly PlacedDayOff[]
  ) {
    this.ranges = new Map(vacations);
    for (const d of dayOffs) this.dayOffs.set(d.id, { userId: d.userId, date: d.date });
  }

  /** Sets (or with null removes) the date of a Dienstfrei, e.g. while the Abgleich assigns dates one by one. */
  place(id: string, userId: string, date: string | null): void {
    if (date) this.dayOffs.set(id, { userId, date });
    else this.dayOffs.delete(id);
  }

  /** Replaces the approved vacations of one person (hypothetical state of a preview). */
  setRanges(userId: string, ranges: readonly DateRange[]): void {
    this.ranges.set(userId, ranges);
  }

  isAbsent(userId: string, date: string): boolean {
    if ((this.ranges.get(userId) ?? []).some((r) => r.from <= date && date <= r.to)) return true;
    for (const d of this.dayOffs.values()) if (d.userId === userId && d.date === date) return true;
    return false;
  }

  private present(scope: StaffingScope, date: string, without: string | null): number {
    return scope.participants.filter((p) => p !== without && !this.isAbsent(p, date)).length;
  }

  /** The gap `userId` being away on `date` would cause (worst scope), or null. */
  gapIfAbsent(userId: string, date: string): StaffingGap | null {
    let worst: StaffingGap | null = null;
    for (const scope of this.scopes) {
      if (!scope.participants.includes(userId) || !isWerktag(scope, date)) continue;
      const present = this.present(scope, date, userId);
      if (present >= scope.minimum) continue;
      if (!worst || present - scope.minimum < worst.present - worst.minimum) {
        worst = { rotationId: scope.rotationId, rotationName: scope.rotationName, date, present, minimum: scope.minimum };
      }
    }
    return worst;
  }

  /** Voller Tag for `userId` (SPEC 12.44), as a predicate for the Dienstfrei rules. */
  isFull(userId: string): (date: string) => boolean {
    return (date) => this.gapIfAbsent(userId, date) !== null;
  }

  /** Werktage among `dates` on which a scope of `userId` is below its minimum as things stand. */
  gapsFor(userId: string, dates: readonly string[]): StaffingGap[] {
    const gaps: StaffingGap[] = [];
    for (const scope of this.scopes) {
      if (!scope.participants.includes(userId)) continue;
      for (const date of dates) {
        if (!isWerktag(scope, date)) continue;
        const present = this.present(scope, date, null);
        if (present < scope.minimum) gaps.push({ rotationId: scope.rotationId, rotationName: scope.rotationName, date, present, minimum: scope.minimum });
      }
    }
    return gaps.sort((a, b) => a.date.localeCompare(b.date) || a.rotationName.localeCompare(b.rotationName));
  }
}

/** A fresh index without scopes or absences; callers mutate indexes, so never share one. */
export function emptyStaffing(): StaffingIndex {
  return new StaffingIndex([], new Map(), []);
}
