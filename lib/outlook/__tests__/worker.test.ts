import { describe, expect, it } from "vitest";
import { isFullRunDue, outlookWorker } from "@/lib/outlook/worker";

describe("isFullRunDue", () => {
  it("runs once per day from 03:00 local time", () => {
    expect(isFullRunDue(null, new Date(2026, 10, 7, 2, 59))).toBe(false);
    expect(isFullRunDue(null, new Date(2026, 10, 7, 3, 0))).toBe(true);
    expect(isFullRunDue("2026-11-07", new Date(2026, 10, 7, 23, 0))).toBe(false);
    expect(isFullRunDue("2026-11-06", new Date(2026, 10, 7, 4, 0))).toBe(true);
  });
});

describe("outlookWorker", () => {
  it("does not start and ignores kicks without configuration", () => {
    expect(() => {
      outlookWorker.start();
      outlookWorker.kick();
      outlookWorker.stop();
    }).not.toThrow();
  });
});
