import { describe, expect, it } from "vitest";

import { choreographHighlights } from "./radarChoreography";
import { CENTRE_LANE, distance } from "./radarGeometry";
import { enqueueBeats, restingPlayback } from "./radarPlayback";
import { type RadarRun, advanceRun, sceneCutOpacity, startRun } from "./radarRun";
import { type RadarScene, type RadarStep, applyStep, initialRadarScene } from "./radarScene";
import { CUT_FADE_IN_S, CUT_FADE_OUT_S, CUT_STAND_S } from "./radarSceneCut";
import { quietSteps } from "./radarSettle";
import { buildRadarStage, scenePositions } from "./radarStage";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";
import { queueBeat, timeSteps } from "./radarTiming";

const snapshot = radarSnapshot();
const stage = buildRadarStage(snapshot);
const start = initialRadarScene(snapshot);
const FRAME_MS = 1000 / 60;
const HOLDER = "h_st1";
/** Deep in the away half, far from the kick-off shapes. */
const FAR = { x: 92, y: CENTRE_LANE };

/** A quick change of scene to `FAR`, the ball back at the holder's feet: the lead-in's step. */
function changeOfScene(sceneCut: boolean): RadarStep {
  return {
    sceneCut,
    ball: { at: FAR, lift: 0 },
    resetMovers: true,
    possession: "Home",
    highlight: [],
    overlay: null,
    pace: "place",
    action: { kind: "dead", spot: FAR, quick: true, holder: HOLDER },
  };
}

/** `steps` queued from `from`, with everyone at rest where `restAt` puts them. */
function runFrom(from: RadarScene, steps: RadarStep[], restAt: RadarScene = from): RadarRun {
  const timed = timeSteps(stage, from, steps);
  const beat = queueBeat(
    {
      key: "scene-change",
      eventType: "Settle",
      steps,
      stepMs: timed.stepMs,
      runMs: timed.runMs,
      important: false,
      prefer: false,
    },
    1,
  );
  const run = startRun(stage, restingPlayback(restAt));
  return {
    ...run,
    playback: enqueueBeats(restingPlayback(from), [beat], Number.POSITIVE_INFINITY),
  };
}

/** Plays `run` frame by frame until its script is played out, every frame kept. */
function playOut(run: RadarRun): RadarRun[] {
  const frames = [run];
  let next = run;
  for (let frame = 0; frame < 60 * 10; frame++) {
    next = advanceRun(next, stage, FRAME_MS);
    frames.push(next);
    if (!next.playback.step && next.playback.queue.length === 0 && next.ball.kind !== "dead") break;
  }
  return frames;
}

const secondsOf = (frames: RadarRun[]) => frames[frames.length - 1].sim.time - frames[0].sim.time;

describe("radar scene cut (after GĐ5)", () => {
  const target = applyStep(start, changeOfScene(true));

  // Given the ball moved far away and the players still in the kick-off
  // shape, when the change of scene plays, then after the fade every player
  // stands in his place around the new ball, still, and the move to there was
  // never seen: they were out of sight when it happened.
  it("puts the players in their places, out of sight, when they are far from them", () => {
    const frames = playOut(runFrom(start, [changeOfScene(true)]));
    const placed = frames.find((run) => run.sceneCut?.placed);
    expect(placed).toBeDefined();
    const places = scenePositions(stage, target);
    const run = placed as RadarRun;
    expect(run.sim.time - frames[0].sim.time).toBeGreaterThanOrEqual(CUT_FADE_OUT_S - 1e-9);
    expect(sceneCutOpacity(run)).toBeLessThan(0.05);
    for (const [id, place] of places) {
      const at = run.sim.players[id]?.at;
      expect(at && distance(at, place), id).toBeLessThan(0.5);
    }
  });

  // Given a cut, then the script holds until the fade out, the fade in and the
  // stand are over (about a second, long enough to read as a cut),
  // and the ball comes back at the feet of the man who starts the move.
  it("holds the script through the fade and the pause, the ball at the holder's feet", () => {
    const frames = playOut(runFrom(start, [changeOfScene(true)]));
    expect(secondsOf(frames)).toBeGreaterThanOrEqual(
      CUT_FADE_OUT_S + CUT_FADE_IN_S + CUT_STAND_S - 1e-9,
    );
    expect(CUT_FADE_OUT_S + CUT_FADE_IN_S + CUT_STAND_S).toBeGreaterThanOrEqual(0.9);
    const last = frames[frames.length - 1];
    expect(last.ball.kind === "held" && last.ball.holder).toBe(HOLDER);
  });

  // Given the players already in their places for the new scene, then there
  // is no cut: nobody is moved and the step takes no longer than before.
  it("does not cut when the players are already in place", () => {
    const frames = playOut(runFrom(start, [changeOfScene(true)], target));
    expect(frames.some((run) => run.sceneCut !== null)).toBe(false);
    expect(frames.every((run) => sceneCutOpacity(run) === 1)).toBe(true);
  });

  // Given a step that is not a change of scene, then the players are never
  // moved, however far from their places they are.
  it("never cuts a step that is not a change of scene", () => {
    const frames = playOut(runFrom(start, [changeOfScene(false)]));
    expect(frames.some((run) => run.sceneCut !== null)).toBe(false);
  });

  // Given a cut, then the players fade out of sight, come back, and stand at
  // full strength before play goes on.
  it("fades the players out and back in, then shows them standing", () => {
    const frames = playOut(runFrom(start, [changeOfScene(true)]));
    const began = frames.find((run) => run.sceneCut !== null) as RadarRun;
    const at = (seconds: number) =>
      frames.find((run) => run.sim.time - (began.sceneCut?.since ?? 0) >= seconds) as RadarRun;
    expect(sceneCutOpacity(at(CUT_FADE_OUT_S * 0.5))).toBeCloseTo(0.5, 1);
    expect(sceneCutOpacity(at(CUT_FADE_OUT_S + CUT_FADE_IN_S / 2))).toBeCloseTo(0.5, 1);
    expect(sceneCutOpacity(at(CUT_FADE_OUT_S + CUT_FADE_IN_S + CUT_STAND_S / 2))).toBe(1);
    expect(sceneCutOpacity(frames[frames.length - 1])).toBe(1);
  });
});

describe("radar scene cut — where a change of scene may cut (after GĐ5)", () => {
  /** The ball deep in the home half, the home side on it: the strikers far from it. */
  const deep: RadarScene = { ...start, ball: { x: 15, y: CENTRE_LANE }, focusX: 15 };

  // Given a move started by a striker far from the ball, then its lead-in is
  // a change of scene that may cut.
  it("marks the lead-in of a move started far from the ball", () => {
    const shot = radarEvent("ShotSaved", "Home", "AwayBox", "h_st1");
    const { beats } = choreographHighlights([shot], stage, deep);
    expect(beats[0].key.startsWith("lead-in")).toBe(true);
    expect(beats[0].steps[0].sceneCut).toBe(true);
  });

  // Given a move started by the man nearest the ball, then there is no
  // lead-in, but the move opens with a short look at the block: a change of
  // scene that may cut, the ball left where it is. Nothing inside the move
  // may cut.
  it("opens a move started at the ball with a check that may cut, and nothing else", () => {
    const shot = radarEvent("ShotSaved", "Home", "HomeDefense", "h_cb1");
    const { beats } = choreographHighlights([shot], stage, deep);
    expect(beats.some((beat) => beat.key.startsWith("lead-in"))).toBe(false);
    const [check, ...move] = beats;
    expect(check.steps).toHaveLength(1);
    expect(check.steps[0].sceneCut).toBe(true);
    expect(check.steps[0].ball).toBeUndefined();
    expect(check.stepMs[0]).toBeLessThan(200);
    expect(move.flatMap((beat) => beat.steps).some((step) => step.sceneCut)).toBe(false);
  });

  // Given a quiet minute, then nothing in it cuts: with no move to start, the
  // players drift after the ball as before, and the screen never flickers
  // through a run of quiet minutes.
  it("never cuts a quiet minute", () => {
    const moved = quietSteps(stage, start, { ballZone: "AwayDefense", possession: "Home" });
    expect(moved.some((step) => step.sceneCut)).toBe(false);
    const { beats } = choreographHighlights([], stage, start, {
      ballZone: "AwayDefense",
      possession: "Home",
    });
    expect(beats.flatMap((beat) => beat.steps).some((step) => step.sceneCut)).toBe(false);
  });
});
