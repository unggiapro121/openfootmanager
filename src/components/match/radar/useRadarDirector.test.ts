import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type MatchSnapshot, SPEED_MS } from "../types";
import { HALFWAY } from "./radarGeometry";
import { advancePlayback } from "./radarPlayback";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";
import { type RadarPacing, radarPacing, useRadarDirector } from "./useRadarDirector";

interface Props {
  snapshot: MatchSnapshot;
  pacing: RadarPacing | null;
  reducedMotion: boolean;
}

const SLOW = radarPacing("slow");
/** Plenty of slack, so a test about what plays is not about what gets skipped. */
const UNHURRIED: RadarPacing = { timeScale: 1, maxLagMs: 60_000, holdMs: 1_000 };
const FAST = radarPacing("fast");
const FRAME_MS = 1000 / 60;

function host(initial: Props) {
  return renderHook(
    ({ snapshot, pacing, reducedMotion }: Props) =>
      useRadarDirector(snapshot, pacing, reducedMotion),
    { initialProps: initial },
  );
}

type Host = ReturnType<typeof host>;

/** Lets `ms` pass, a frame at a time, as the radar's frame loop would; `watch` sees every frame. */
function play(hosted: Host, ms: number, watch?: () => void) {
  for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) {
    act(() => {
      vi.advanceTimersByTime(FRAME_MS);
      const { playback } = hosted.result.current;
      playback.current = advancePlayback(playback.current, FRAME_MS);
    });
    watch?.();
  }
}

const sceneOf = (hosted: Host) => hosted.result.current.playback.current.scene;

const dribble = radarEvent("Dribble", "Home", "AwayDefense", "h_st1");

describe("useRadarDirector", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Given a match on the radar, when a new minute brings a dribble, then the
  // dribble plays out: the ball ends further up the pitch, the dribbler named.
  it("plays a new minute's events out", () => {
    const hosted = host({ snapshot: radarSnapshot(), pacing: SLOW, reducedMotion: false });
    expect(sceneOf(hosted).ball.x).toBe(HALFWAY);

    const next = radarSnapshot({ events: [dribble], ball_zone: "AwayDefense" });
    hosted.rerender({ snapshot: next, pacing: SLOW, reducedMotion: false });
    play(hosted, 4000);
    expect(sceneOf(hosted).ball.x).toBeGreaterThan(HALFWAY);
    expect(sceneOf(hosted).highlight).toContain("h_st1");
  });

  // Given the skip-ahead speed, when a minute arrives, then the radar rests at
  // its end at once, with nothing left to play.
  it("jumps to the end at the skip-ahead speed", () => {
    const hosted = host({ snapshot: radarSnapshot(), pacing: null, reducedMotion: false });
    hosted.rerender({
      snapshot: radarSnapshot({ events: [dribble], ball_zone: "AwayDefense" }),
      pacing: null,
      reducedMotion: false,
    });
    const { playback } = hosted.result.current;
    expect(playback.current.scene.ball.x).toBeGreaterThan(HALFWAY);
    expect(playback.current.queue).toHaveLength(0);
    expect(playback.current.step).toBeNull();
  });

  // Given a player who prefers reduced motion, when a minute arrives, then
  // nothing plays out: the radar rests at the end of the minute at once.
  it("does not animate for reduced motion", () => {
    const hosted = host({ snapshot: radarSnapshot(), pacing: SLOW, reducedMotion: true });
    hosted.rerender({
      snapshot: radarSnapshot({ events: [dribble], ball_zone: "AwayDefense" }),
      pacing: SLOW,
      reducedMotion: true,
    });
    const { playback } = hosted.result.current;
    expect(playback.current.scene.ball.x).toBeGreaterThan(HALFWAY);
    expect(playback.current.step).toBeNull();
  });

  // Given the radar opening on a match already under way (the second half),
  // then it does not replay the first half's events.
  it("does not replay events from before it opened", () => {
    const underway = radarSnapshot({
      events: [radarEvent("Goal", "Home", "AwayBox", "h_st1")],
      ball_zone: "Midfield",
    });
    const hosted = host({ snapshot: underway, pacing: SLOW, reducedMotion: false });
    play(hosted, 3000);
    expect(sceneOf(hosted).goal).toBeNull();
    expect(sceneOf(hosted).ball.x).toBe(HALFWAY);
  });

  // Given a dribble still playing, when the next minute lands, then the dribble
  // is not cut short: it plays on, and the next minute follows it.
  it("lets a dribble finish before the next minute plays", () => {
    const hosted = host({ snapshot: radarSnapshot(), pacing: SLOW, reducedMotion: false });
    hosted.rerender({
      snapshot: radarSnapshot({ events: [dribble], ball_zone: "AwayDefense" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    play(hosted, 300);
    const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1", null, 11);
    hosted.rerender({
      snapshot: radarSnapshot({ events: [dribble, goal], ball_zone: "Midfield" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    play(hosted, 500);
    expect(hosted.result.current.playback.current.beat?.beat.eventType).toBe("Dribble");
    expect(sceneOf(hosted).goal).toBeNull();
    play(hosted, 6000);
    expect(sceneOf(hosted).goal?.side).toBe("Home");
  });

  // Given a pass that ends a minute and a team-mate who acts first in the next,
  // then the pass is played to him.
  it("plays a pass to the next minute's man on the ball", () => {
    const pass = radarEvent("PassCompleted", "Home", "Midfield", "h_cm2", null, 20);
    const run = radarEvent("Dribble", "Home", "AwayDefense", "h_rm", null, 21);
    const hosted = host({ snapshot: radarSnapshot(), pacing: UNHURRIED, reducedMotion: false });
    const passedTo = new Set<string>();
    const watch = () => {
      const { highlight } = sceneOf(hosted);
      if (highlight.includes("h_cm2")) {
        for (const id of highlight) if (id !== "h_cm2") passedTo.add(id);
      }
    };
    hosted.rerender({
      snapshot: radarSnapshot({ events: [pass], ball_zone: "AwayDefense" }),
      pacing: UNHURRIED,
      reducedMotion: false,
    });
    play(hosted, 400, watch);
    hosted.rerender({
      snapshot: radarSnapshot({ events: [pass, run], ball_zone: "AwayBox" }),
      pacing: UNHURRIED,
      reducedMotion: false,
    });
    play(hosted, 8000, watch);
    expect([...passedTo]).toEqual(["h_rm"]);
  });

  // Given a slow match, where the next minute lands a full tick after the pass,
  // then the pass still waits for it: the ball never goes to a stand-in, only
  // to the man who acts next (the pass itself may be skipped to keep up).
  it("holds a pass for the next minute at the slow speed", () => {
    const pass = radarEvent("PassCompleted", "Home", "Midfield", "h_cm2", null, 20);
    const run = radarEvent("Dribble", "Home", "AwayDefense", "h_rm", null, 21);
    const hosted = host({ snapshot: radarSnapshot(), pacing: SLOW, reducedMotion: false });
    const passedTo = new Set<string>();
    let runnerShown = false;
    const watch = () => {
      const { highlight } = sceneOf(hosted);
      if (highlight.includes("h_cm2")) {
        for (const id of highlight) if (id !== "h_cm2") passedTo.add(id);
      }
      runnerShown ||= highlight.includes("h_rm");
    };
    hosted.rerender({
      snapshot: radarSnapshot({ events: [pass], ball_zone: "AwayDefense" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    play(hosted, 2200, watch);
    hosted.rerender({
      snapshot: radarSnapshot({ events: [pass, run], ball_zone: "AwayBox" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    play(hosted, 8000, watch);
    expect([...passedTo].filter((id) => id !== "h_rm")).toEqual([]);
    expect(runnerShown).toBe(true);
  });

  // Given a pass that ends a minute and no minute after it (the match paused),
  // then the pass still plays after a short wait.
  it("plays a held pass on its own when no minute follows", () => {
    const pass = radarEvent("PassCompleted", "Home", "HomeDefense", "h_cb1", null, 20);
    const hosted = host({ snapshot: radarSnapshot(), pacing: SLOW, reducedMotion: false });
    hosted.rerender({
      snapshot: radarSnapshot({ events: [pass], ball_zone: "Midfield" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    play(hosted, 5000);
    expect(sceneOf(hosted).highlight).toContain("h_cb1");
  });

  // Given a fast match that keeps landing minutes, then the radar skips routine
  // play to keep up but still shows the goal at the end.
  it("keeps up with a fast match without losing a goal", () => {
    let events = [] as ReturnType<typeof radarEvent>[];
    const hosted = host({ snapshot: radarSnapshot(), pacing: FAST, reducedMotion: false });
    for (let minute = 1; minute <= 12; minute++) {
      events = [
        ...events,
        radarEvent("PassCompleted", "Home", "Midfield", "h_cm1", null, minute),
        radarEvent("Dribble", "Home", "AwayDefense", "h_st1", null, minute),
      ];
      hosted.rerender({
        snapshot: radarSnapshot({ events, ball_zone: "AwayDefense" }),
        pacing: FAST,
        reducedMotion: false,
      });
      play(hosted, 200);
    }
    const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1", null, 13);
    hosted.rerender({
      snapshot: radarSnapshot({ events: [...events, goal], ball_zone: "Midfield" }),
      pacing: FAST,
      reducedMotion: false,
    });
    play(hosted, (FAST?.maxLagMs ?? 0) + 2500);
    expect(sceneOf(hosted).goal?.side).toBe("Home");
  });
});

describe("radarPacing", () => {
  // Given each simulation speed, then movements keep a real pace (a faster
  // match plays only a little quicker), the skip-ahead speed does not animate,
  // and a single step while paused plays at the normal pace.
  it("follows the simulation speed", () => {
    const slow = radarPacing("slow");
    const normal = radarPacing("normal");
    const fast = radarPacing("fast");
    expect(normal?.timeScale ?? 0).toBeLessThan(slow?.timeScale ?? 0);
    expect(fast?.timeScale ?? 0).toBeLessThan(normal?.timeScale ?? 0);
    // Never more than twice life speed, even when the match is fast.
    expect(fast?.timeScale ?? 0).toBeGreaterThanOrEqual(0.5);
    expect(radarPacing("instant")).toBeNull();
    const paused = radarPacing("paused");
    expect(paused?.timeScale).toBe(normal?.timeScale);
    expect(paused?.maxLagMs).toBe(normal?.maxLagMs);
  });

  // Given a slower match, then the radar may trail it a little further, since
  // each minute lasts longer.
  it("lets a slower match trail further behind", () => {
    expect(radarPacing("slow")?.maxLagMs ?? 0).toBeGreaterThan(radarPacing("fast")?.maxLagMs ?? 0);
  });

  // Given each running speed, then a pass that ends a minute waits longer than
  // a tick, so the next minute can name its receiver.
  it("holds a pass longer than a tick", () => {
    for (const speed of ["slow", "normal", "fast"] as const) {
      expect(radarPacing(speed)?.holdMs ?? 0).toBeGreaterThan(SPEED_MS[speed]);
    }
  });
});
