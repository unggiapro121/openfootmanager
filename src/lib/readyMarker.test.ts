import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scripts/mobile-measure.sh` times a cold start up to the moment a screen is usable by reading
 * one log line per milestone (phase 5 M2b-11 of m2-tech-spec). The line carries no personal data
 * and is written by the phone app only, once per milestone.
 */
const logInfo = vi.fn();
const platformState = { mobile: true };

vi.mock("./logger", () => ({ logInfo: (message: string) => logInfo(message) }));
vi.mock("./platform", () => ({ isMobileBuild: () => platformState.mobile }));

beforeEach(() => {
  vi.resetModules();
  logInfo.mockClear();
  platformState.mobile = true;
});

describe("markReady", () => {
  // Given the phone app, when a milestone is reached, then one `OFM_READY <stage> <ms>` line is logged.
  it("logs the milestone and the time since the page started on the phone app", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1234.6);
    const { markReady } = await import("./readyMarker");
    markReady("login");
    expect(logInfo).toHaveBeenCalledWith("OFM_READY login 1235");
  });

  // Given a milestone already logged, when it is reached again (a re-render, a second visit),
  // then nothing more is logged: only the first time counts for a cold start.
  it("logs each milestone once", async () => {
    const { markReady } = await import("./readyMarker");
    markReady("overview");
    markReady("overview");
    markReady("login");
    expect(logInfo).toHaveBeenCalledTimes(2);
  });

  // Given the desktop app, when a milestone is reached, then nothing is logged.
  it("logs nothing on desktop", async () => {
    platformState.mobile = false;
    const { markReady } = await import("./readyMarker");
    markReady("login");
    expect(logInfo).not.toHaveBeenCalled();
  });
});
