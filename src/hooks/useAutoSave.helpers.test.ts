import { describe, expect, it } from "vitest";

import { autoSaveDelayMs } from "./useAutoSave.helpers";

const MINUTE = 60_000;

describe("autoSaveDelayMs", () => {
  /** Given changes made 10 minutes ago and a 30-minute interval, then 20 minutes remain. */
  it("counts the interval from the first unsaved change", () => {
    expect(
      autoSaveDelayMs({
        now: 10 * MINUTE,
        dirtySince: 0,
        lastAttemptAt: null,
        intervalMinutes: 30,
      }),
    ).toBe(20 * MINUTE);
  });

  /** Given changes older than the interval, then the save is overdue. */
  it("is due once the interval has passed", () => {
    expect(
      autoSaveDelayMs({
        now: 45 * MINUTE,
        dirtySince: 0,
        lastAttemptAt: null,
        intervalMinutes: 30,
      }),
    ).toBeLessThanOrEqual(0);
  });

  /** Given a save that just failed, then the next attempt waits a full interval. */
  it("waits a full interval after a failed attempt", () => {
    expect(
      autoSaveDelayMs({
        now: 31 * MINUTE,
        dirtySince: 0,
        lastAttemptAt: 30 * MINUTE,
        intervalMinutes: 30,
      }),
    ).toBe(29 * MINUTE);
  });
});
