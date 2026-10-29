// [fork] Urlaub: service error with a code the routes map to HTTP statuses.
import type { VacationErrorCode } from "@/lib/vacation/types";

export class VacationServiceError extends Error {
  constructor(public readonly code: VacationErrorCode) {
    super(code);
  }
}
