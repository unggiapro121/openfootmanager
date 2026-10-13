import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchSnapshot } from "../types";
import { HALFWAY } from "./radarGeometry";
import { advancePlayback } from "./radarPlayback";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";
import { RADAR_PACING, type RadarPacing, useRadarDirector } from "./useRadarDirector";

interface Props {
  snapshot: MatchSnapshot;
  pacing: RadarPacing | null;
  reducedMotion: boolean;
}

const SLOW = RADAR_PACING;
/** Real pace, so a test about what plays is not about how fast. */
const UNHURRIED: RadarPacing = { timeScale: 1, maxLagMs: 60_000, holdMs: 1_000 };
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
/** An attack the radar acts out: a dribble, and the shot it ends in. */
const attack = [dribble, radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk")];

describe("useRadarDirector", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Given a match on the radar, when a new minute brings a dribble, then the
  // dribble plays out: the ball ends further up the pitch, the dribbler named.
  it("plays a new minute's events out", () => {
    const hosted = host({ snapshot: radarSnapshot(), pacing: SLOW, reducedMotion: false });
    expect(sceneOf(hosted).ball.x).toBe(HALFWAY);

    const next = radarSnapshot({ events: attack, ball_zone: "AwayBox" });
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
      snapshot: radarSnapshot({ events: attack, ball_zone: "AwayBox" }),
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
      snapshot: radarSnapshot({ events: attack, ball_zone: "AwayBox" }),
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

  // Given an attack still playing, when the next minute lands, then the attack
  // is not cut short: it plays on, and the next minute follows it.
  it("lets an attack finish before the next minute plays", () => {
    const hosted = host({ snapshot: radarSnapshot(), pacing: SLOW, reducedMotion: false });
    hosted.rerender({
      snapshot: radarSnapshot({ events: attack, ball_zone: "AwayBox" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    play(hosted, 300);
    const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1", null, 11);
    hosted.rerender({
      snapshot: radarSnapshot({ events: [...attack, goal], ball_zone: "Midfield" }),
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
    const shot = radarEvent("ShotOffTarget", "Home", "AwayBox", "h_rm", null, 21);
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
      snapshot: radarSnapshot({ events: [pass, run, shot], ball_zone: "AwayBox" }),
      pacing: UNHURRIED,
      reducedMotion: false,
    });
    play(hosted, 8000, watch);
    expect([...passedTo]).toEqual(["h_rm"]);
  });

  // Given the next minute landing a while after a pass that ends a minute, then
  // the pass still waits for it: the ball never goes to a stand-in, only to the
  // man who acts next.
  it("holds a pass for the next minute when it is slow to come", () => {
    const pass = radarEvent("PassCompleted", "Home", "Midfield", "h_cm2", null, 20);
    const run = radarEvent("Dribble", "Home", "AwayDefense", "h_rm", null, 21);
    const shot = radarEvent("ShotOffTarget", "Home", "AwayBox", "h_rm", null, 21);
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
      snapshot: radarSnapshot({ events: [pass, run, shot], ball_zone: "AwayBox" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    play(hosted, 8000, watch);
    expect([...passedTo].filter((id) => id !== "h_rm")).toEqual([]);
    expect(runnerShown).toBe(true);
  });

  // Given a pass that ends a minute and no minute after it (the match paused),
  // then the radar does not stall on it: it lets it go after a short wait and
  // comes to rest.
  it("lets a held pass go when no minute follows", () => {
    const pass = radarEvent("PassCompleted", "Home", "HomeDefense", "h_cb1", null, 20);
    const hosted = host({ snapshot: radarSnapshot(), pacing: SLOW, reducedMotion: false });
    hosted.rerender({
      snapshot: radarSnapshot({ events: [pass], ball_zone: "Midfield" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    play(hosted, 5000);
    const { playback } = hosted.result.current;
    expect(playback.current.step).toBeNull();
    expect(playback.current.queue).toHaveLength(0);
  });

  // Given a minute with nothing dangerous in it, then the radar passes over it
  // in a moment, the ball put where the engine left it.
  it("passes over a quiet minute in a moment", () => {
    const quiet = [
      radarEvent("PassCompleted", "Home", "HomeDefense", "h_cb1"),
      radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
      radarEvent("Tackle", "Away", "Midfield", "a_cm1"),
    ];
    const hosted = host({ snapshot: radarSnapshot(), pacing: SLOW, reducedMotion: false });
    hosted.rerender({
      snapshot: radarSnapshot({ events: quiet, ball_zone: "HomeDefense", possession: "Away" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    const beats = hosted.result.current.playback.current.queue;
    expect(beats).toHaveLength(1);
    expect(beats[0].stepMs.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(500);
    expect(sceneOf(hosted).highlight).toEqual([]);
  });

  // Given a minute, then the director counts its events as taken in at once,
  // so the screen knows the radar has it.
  it("counts the events it has taken in", () => {
    const hosted = host({ snapshot: radarSnapshot(), pacing: SLOW, reducedMotion: false });
    expect(hosted.result.current.staged.current).toBe(0);
    hosted.rerender({
      snapshot: radarSnapshot({ events: attack, ball_zone: "AwayBox" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    expect(hosted.result.current.staged.current).toBe(2);
  });

  // Given several minutes each with a goal, queued behind one another, then
  // every one is played: the match waits for the radar, so nothing is skipped.
  it("plays every minute it is given, skipping none", () => {
    let events = [] as ReturnType<typeof radarEvent>[];
    const hosted = host({ snapshot: radarSnapshot(), pacing: SLOW, reducedMotion: false });
    for (let minute = 1; minute <= 3; minute++) {
      events = [...events, radarEvent("Goal", "Home", "AwayBox", "h_st1", null, minute)];
      hosted.rerender({
        snapshot: radarSnapshot({ events, ball_zone: "Midfield", possession: "Away" }),
        pacing: SLOW,
        reducedMotion: false,
      });
    }
    play(hosted, 30_000);
    expect(sceneOf(hosted).goal?.serial).toBe(3);
  });
});

describe("RADAR_PACING", () => {
  // Given the 2D mode, where the match waits for the radar, then nothing is
  // ever skipped to keep up, and play runs a little quicker than life but not
  // so quick that it slides.
  it("never skips, at a pace close to life", () => {
    expect(RADAR_PACING.maxLagMs).toBe(Number.POSITIVE_INFINITY);
    expect(RADAR_PACING.timeScale).toBeGreaterThanOrEqual(0.6);
    expect(RADAR_PACING.timeScale).toBeLessThanOrEqual(1);
  });
});
