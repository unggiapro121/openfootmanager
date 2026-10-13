import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type MatchSnapshot, SPEED_MS } from "../types";
import { HALFWAY } from "./radarGeometry";
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

function host(initial: Props) {
  return renderHook(
    ({ snapshot, pacing, reducedMotion }: Props) =>
      useRadarDirector(snapshot, pacing, reducedMotion),
    { initialProps: initial },
  );
}

const dribble = radarEvent("Dribble", "Home", "AwayDefense", "h_st1");

describe("useRadarDirector", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Given a match on the radar, when a new minute brings a dribble, then the
  // dribble plays out: the ball starts at the dribbler and ends further up the
  // pitch, with a transition to get there.
  it("plays a new minute's events out", () => {
    const { result, rerender } = host({
      snapshot: radarSnapshot(),
      pacing: SLOW,
      reducedMotion: false,
    });
    expect(result.current.scene.ball.x).toBe(HALFWAY);

    const next = radarSnapshot({ events: [dribble], ball_zone: "AwayDefense" });
    rerender({ snapshot: next, pacing: SLOW, reducedMotion: false });
    const atStart = result.current.scene.ball.x;

    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.scene.ball.x).toBeGreaterThan(atStart);
    expect(result.current.scene.ballMs).toBeGreaterThan(0);
    expect(result.current.scene.highlight).toContain("h_st1");
  });

  // Given the skip-ahead speed, when a minute arrives, then the radar jumps
  // straight to its end without animating.
  it("jumps to the end at the skip-ahead speed", () => {
    const { result, rerender } = host({
      snapshot: radarSnapshot(),
      pacing: null,
      reducedMotion: false,
    });
    rerender({
      snapshot: radarSnapshot({ events: [dribble], ball_zone: "AwayDefense" }),
      pacing: null,
      reducedMotion: false,
    });
    expect(result.current.scene.ball.x).toBeGreaterThan(HALFWAY);
    expect(result.current.scene.ballMs).toBe(0);
  });

  // Given a player who prefers reduced motion, when a minute arrives, then
  // nothing glides: the radar shows the end of the minute at once.
  it("does not animate for reduced motion", () => {
    const { result, rerender } = host({
      snapshot: radarSnapshot(),
      pacing: SLOW,
      reducedMotion: true,
    });
    rerender({
      snapshot: radarSnapshot({ events: [dribble], ball_zone: "AwayDefense" }),
      pacing: SLOW,
      reducedMotion: true,
    });
    expect(result.current.scene.ball.x).toBeGreaterThan(HALFWAY);
    expect(result.current.scene.moveMs).toBe(0);
  });

  // Given the radar opening on a match already under way (the second half),
  // then it does not replay the first half's events.
  it("does not replay events from before it opened", () => {
    const underway = radarSnapshot({
      events: [radarEvent("Goal", "Home", "AwayBox", "h_st1")],
      ball_zone: "Midfield",
    });
    const { result } = host({ snapshot: underway, pacing: SLOW, reducedMotion: false });
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.scene.goal).toBeNull();
    expect(result.current.scene.ball.x).toBe(HALFWAY);
  });

  // Given a dribble still playing, when the next minute lands, then the dribble
  // is not cut short: it plays on, and the next minute follows it.
  it("lets a dribble finish before the next minute plays", () => {
    const { result, rerender } = host({
      snapshot: radarSnapshot(),
      pacing: SLOW,
      reducedMotion: false,
    });
    rerender({
      snapshot: radarSnapshot({ events: [dribble], ball_zone: "AwayDefense" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    act(() => vi.advanceTimersByTime(300));
    const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1", null, 11);
    rerender({
      snapshot: radarSnapshot({ events: [dribble, goal], ball_zone: "Midfield" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.scene.highlight).toContain("h_st1");
    expect(result.current.scene.moveEase).toBe("linear");
    expect(result.current.scene.goal).toBeNull();

    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.scene.goal?.side).toBe("Home");
  });

  // Given a pass that ends one minute and a dribble that starts the next, then
  // the pass goes to the dribbler — the man the engine had on the ball next —
  // rather than to a team-mate guessed before the next minute arrived.
  it("plays a pass to the next minute's man on the ball", () => {
    const pass = radarEvent("PassCompleted", "Home", "Midfield", "h_cm2", null, 20);
    const run = radarEvent("Dribble", "Home", "AwayDefense", "h_rm", null, 21);
    const { result, rerender } = host({
      snapshot: radarSnapshot(),
      pacing: UNHURRIED,
      reducedMotion: false,
    });
    const passedTo = new Set<string>();
    const watch = () => {
      const { highlight } = result.current.scene;
      if (highlight.includes("h_cm2")) {
        for (const id of highlight) if (id !== "h_cm2") passedTo.add(id);
      }
    };
    rerender({
      snapshot: radarSnapshot({ events: [pass], ball_zone: "AwayDefense" }),
      pacing: UNHURRIED,
      reducedMotion: false,
    });
    act(() => vi.advanceTimersByTime(400));
    rerender({
      snapshot: radarSnapshot({ events: [pass, run], ball_zone: "AwayBox" }),
      pacing: UNHURRIED,
      reducedMotion: false,
    });
    for (let elapsed = 0; elapsed < 8000; elapsed += 50) {
      act(() => vi.advanceTimersByTime(50));
      watch();
    }
    expect([...passedTo]).toEqual(["h_rm"]);
  });

  // Given a slow match, where the next minute lands a full tick after the pass,
  // then the pass still waits for it: the ball never goes to a stand-in, only
  // to the man who acts next (the pass itself may be skipped to keep up).
  it("holds a pass for the next minute at the slow speed", () => {
    const pass = radarEvent("PassCompleted", "Home", "Midfield", "h_cm2", null, 20);
    const run = radarEvent("Dribble", "Home", "AwayDefense", "h_rm", null, 21);
    const { result, rerender } = host({
      snapshot: radarSnapshot(),
      pacing: SLOW,
      reducedMotion: false,
    });
    const passedTo = new Set<string>();
    const watch = () => {
      const { highlight } = result.current.scene;
      if (highlight.includes("h_cm2")) {
        for (const id of highlight) if (id !== "h_cm2") passedTo.add(id);
      }
    };
    rerender({
      snapshot: radarSnapshot({ events: [pass], ball_zone: "AwayDefense" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    for (let elapsed = 0; elapsed < 2200; elapsed += 50) {
      act(() => vi.advanceTimersByTime(50));
      watch();
    }
    rerender({
      snapshot: radarSnapshot({ events: [pass, run], ball_zone: "AwayBox" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    let runnerShown = false;
    for (let elapsed = 0; elapsed < 8000; elapsed += 50) {
      act(() => vi.advanceTimersByTime(50));
      watch();
      runnerShown ||= result.current.scene.highlight.includes("h_rm");
    }
    expect([...passedTo].filter((id) => id !== "h_rm")).toEqual([]);
    expect(runnerShown).toBe(true);
  });

  // Given a pass that ends a minute and no minute after it (the match paused),
  // then the pass still plays after a short wait.
  it("plays a held pass on its own when no minute follows", () => {
    const pass = radarEvent("PassCompleted", "Home", "HomeDefense", "h_cb1", null, 20);
    const { result, rerender } = host({
      snapshot: radarSnapshot(),
      pacing: SLOW,
      reducedMotion: false,
    });
    rerender({
      snapshot: radarSnapshot({ events: [pass], ball_zone: "Midfield" }),
      pacing: SLOW,
      reducedMotion: false,
    });
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.scene.highlight).toContain("h_cb1");
  });

  // Given a fast match that keeps landing minutes, then the radar skips routine
  // play to keep up but still shows the goal at the end.
  it("keeps up with a fast match without losing a goal", () => {
    let events = [] as ReturnType<typeof radarEvent>[];
    const { result, rerender } = host({
      snapshot: radarSnapshot(),
      pacing: FAST,
      reducedMotion: false,
    });
    for (let minute = 1; minute <= 12; minute++) {
      events = [
        ...events,
        radarEvent("PassCompleted", "Home", "Midfield", "h_cm1", null, minute),
        radarEvent("Dribble", "Home", "AwayDefense", "h_st1", null, minute),
      ];
      rerender({
        snapshot: radarSnapshot({ events, ball_zone: "AwayDefense" }),
        pacing: FAST,
        reducedMotion: false,
      });
      act(() => vi.advanceTimersByTime(200));
    }
    const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1", null, 13);
    rerender({
      snapshot: radarSnapshot({ events: [...events, goal], ball_zone: "Midfield" }),
      pacing: FAST,
      reducedMotion: false,
    });
    act(() => vi.advanceTimersByTime(FAST?.maxLagMs ?? 0));
    act(() => vi.advanceTimersByTime(2500));
    expect(result.current.scene.goal?.side).toBe("Home");
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
