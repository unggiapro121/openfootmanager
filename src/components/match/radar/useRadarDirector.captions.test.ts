import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchSnapshot } from "../types";
import type { RadarCaption } from "./radarCaptions";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";
import { RADAR_PACING, useRadarDirector } from "./useRadarDirector";

interface Props {
  snapshot: MatchSnapshot;
  reducedMotion: boolean;
}

function host(initial: Props, onCaption?: (caption: RadarCaption) => void) {
  return renderHook(
    ({ snapshot, reducedMotion }: Props) =>
      useRadarDirector(snapshot, RADAR_PACING, reducedMotion, onCaption),
    { initialProps: initial },
  );
}

/** The captions queued on the last beat of what the radar will play. */
function lastBeatCaptions(hosted: ReturnType<typeof host>): RadarCaption[] {
  const { queue } = hosted.result.current.playback.current;
  return (queue[queue.length - 1]?.beat.captions ?? []).map((entry) => entry.caption);
}

describe("useRadarDirector — commentary around the play", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * Given a quiet minute ending in a pass, then the pass is held back for the
   * next minute and the minute's moment on the radar carries a summary line.
   */
  it("gives a quiet minute a summary line", () => {
    const hosted = host({ snapshot: radarSnapshot(), reducedMotion: false });
    hosted.rerender({
      snapshot: radarSnapshot({
        events: [radarEvent("PassCompleted", "Away", "Midfield", "a_cm1", null, 11)],
        possession: "Away",
        ball_zone: "AwayDefense",
        current_minute: 11,
      }),
      reducedMotion: false,
    });
    expect(lastBeatCaptions(hosted)).toEqual([
      expect.objectContaining({ kind: "line", priority: "filler", keys: ["summary.ownHalf"] }),
    ]);
  });

  /** Given a minute with a booking the radar does not act out, then the booking is told after the minute's play. */
  it("tells a booking the radar does not show", () => {
    const booking = radarEvent("YellowCard", "Away", "Midfield", "a_cm1", null, 11);
    const hosted = host({ snapshot: radarSnapshot(), reducedMotion: false });
    hosted.rerender({
      snapshot: radarSnapshot({ events: [booking], ball_zone: "AwayDefense", current_minute: 11 }),
      reducedMotion: false,
    });
    expect(lastBeatCaptions(hosted)).toEqual([
      { kind: "event", priority: "key", event: booking, assist: null },
    ]);
  });

  /** Given motion reduced, when a minute arrives, then its captions are said at once, in order. */
  it("says a still minute's captions at once", () => {
    const onCaption = vi.fn();
    const shot = radarEvent("ShotOffTarget", "Home", "AwayBox", "h_st1", null, 11);
    const hosted = host({ snapshot: radarSnapshot(), reducedMotion: true }, onCaption);
    hosted.rerender({
      snapshot: radarSnapshot({ events: [shot], ball_zone: "HomeDefense", current_minute: 11 }),
      reducedMotion: true,
    });
    const said = onCaption.mock.calls.map(([caption]) => caption as RadarCaption);
    expect(said.map((caption) => caption.kind)).toEqual(["line", "event"]);
    expect(said[1]).toMatchObject({ kind: "event", event: shot });
  });
});
