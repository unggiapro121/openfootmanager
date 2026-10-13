import { describe, expect, it } from "vitest";

import { advancePlayback, enqueueBeats, jumpTo, restingPlayback } from "./radarPlayback";
import { type RadarBeat, initialRadarScene } from "./radarScene";
import { radarSnapshot } from "./radarTestFixtures";
import { type QueuedBeat, queueBeat } from "./radarTiming";

const start = initialRadarScene(radarSnapshot());

function beat(key: string, ballXs: number[], stepMs: number[], important = false): RadarBeat {
  return {
    key,
    eventType: "PassCompleted",
    steps: ballXs.map((x) => ({ ball: { at: { x, y: start.ball.y } } })),
    stepMs,
    runMs: stepMs.map(() => ({})),
    important,
    prefer: false,
  };
}

const queued = (...beats: RadarBeat[]): QueuedBeat[] => beats.map((entry) => queueBeat(entry, 1));

describe("radar playback", () => {
  // Given a beat of two steps, when time passes, then each step is on screen
  // for its own length, one after the other, and play rests where the last
  // one leaves it.
  it("plays a beat's steps one after another, each for its time", () => {
    let playback = enqueueBeats(
      restingPlayback(start),
      queued(beat("a", [60, 70], [100, 200])),
      10_000,
    );
    playback = advancePlayback(playback, 50);
    expect(playback.step?.to.ball.x).toBe(60);
    expect(playback.step?.elapsed).toBe(50);
    playback = advancePlayback(playback, 100);
    expect(playback.step?.to.ball.x).toBe(70);
    expect(playback.step?.from.ball.x).toBe(60);
    expect(playback.step?.elapsed).toBe(50);
    playback = advancePlayback(playback, 200);
    expect(playback.step).toBeNull();
    expect(playback.scene.ball.x).toBe(70);
  });

  // Given two queued beats and a long frame, then time left over at the end of
  // one beat goes into the next, so nothing drifts behind the clock.
  it("carries time over from one beat into the next", () => {
    let playback = enqueueBeats(
      restingPlayback(start),
      queued(beat("a", [60], [100]), beat("b", [70], [100])),
      10_000,
    );
    playback = advancePlayback(playback, 130);
    expect(playback.step?.to.ball.x).toBe(70);
    expect(playback.step?.elapsed).toBe(30);
  });

  // Given more queued than the radar may lag behind the match, then routine
  // beats are dropped so the radar stays within it (T1).
  it("never queues more than the radar may lag", () => {
    const many = Array.from({ length: 10 }, (_, index) => beat(`b${index}`, [60], [900]));
    const playback = enqueueBeats(restingPlayback(start), queued(...many), 2000);
    const queuedMs = playback.queue.reduce((sum, entry) => sum + entry.stepMs[0], 0);
    expect(queuedMs).toBeLessThanOrEqual(2000);
  });

  // Given the skip-ahead speed, then everything queued is dropped and play
  // rests at once at the end of the minute.
  it("jumps straight to the end", () => {
    const playback = jumpTo({ ...start, ball: { x: 90, y: 10 } });
    expect(playback.queue).toHaveLength(0);
    expect(playback.step).toBeNull();
    expect(playback.scene.ball).toEqual({ x: 90, y: 10 });
  });
});
