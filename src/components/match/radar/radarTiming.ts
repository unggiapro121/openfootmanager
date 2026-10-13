import { type PitchPoint, clamp, distance, lerp } from "./radarGeometry";
import {
  type RadarBeat,
  type RadarPace,
  type RadarScene,
  type RadarStep,
  applyStep,
  focusOf,
} from "./radarScene";
import { type RadarStage, standingIn } from "./radarStage";

/**
 * How long the radar's movements take, and how it keeps up with the match.
 * Every movement takes as long as it would on a real pitch: a ball at a ball's
 * speed, a player at a player's.
 */

/** Metres per second of radar time for each pace. */
export const PACE_SPEED: Record<"pass" | "shot" | "air" | "carry" | "run", number> = {
  pass: 20,
  shot: 28,
  air: 15,
  // A player running with the ball, a little slower than without it.
  carry: 6.5,
  run: 7,
};
/** A player going back into shape once his part is played: a jog, not a sprint. */
const JOG_SPEED = 4;
const PLACE_MS = 450;
/** Long enough to read a card or a whistle before the next beat clears it. */
const HOLD_MS = 650;
const MIN_STEP_MS = 160;
const MAX_STEP_MS = 2400;
/** The shortest run worth a pace of its own: anything less is a step on the spot. */
const MIN_RUN_MS = 300;
/** Below this the ball has not really moved. */
const BALL_STILL_METRES = 0.5;

/** How long `metres` take at `pace`, in seconds of real pace, as a step would be timed. */
export function paceSeconds(
  pace: "pass" | "shot" | "air" | "carry" | "run",
  metres: number,
): number {
  return clamp((metres / PACE_SPEED[pace]) * 1000, MIN_STEP_MS, MAX_STEP_MS) / 1000;
}

/**
 * The furthest point from `from` towards `want` that a runner reaches in time
 * to meet the ball there: no later than the ball, which takes
 * `ballSecondsTo(point)` to get there once played, with `headStart` seconds of
 * running before it is. A pass is played to where the man will be, never left
 * waiting for him.
 */
export function meetingPoint(
  from: PitchPoint,
  want: PitchPoint,
  ballSecondsTo: (point: PitchPoint) => number,
  headStart: number,
): PitchPoint {
  for (let share = 20; share > 0; share--) {
    const point = lerp(from, want, share / 20);
    if (distance(from, point) / PACE_SPEED.run <= ballSecondsTo(point) + headStart) return point;
  }
  return from;
}

/**
 * Where a runner from `runnerFrom`, at `speed` metres a second, first gets
 * across the line of a ball played from `ballFrom` to `ballTo`, between
 * `earliest` and `latest` of the way along it, with `headStart` seconds'
 * warning. If he cannot make it anywhere, the point of the line nearest him.
 */
export function crossingPoint(
  ballFrom: PitchPoint,
  ballTo: PitchPoint,
  runnerFrom: PitchPoint,
  headStart: number,
  speed: number,
  [earliest, latest]: [number, number],
): PitchPoint {
  let nearest = lerp(ballFrom, ballTo, latest);
  for (let share = earliest; share <= latest + 1e-9; share += 0.05) {
    const point = lerp(ballFrom, ballTo, share);
    const ballSeconds = distance(ballFrom, point) / PACE_SPEED.pass;
    if (distance(runnerFrom, point) / speed <= ballSeconds + headStart) return point;
    if (distance(runnerFrom, point) < distance(runnerFrom, nearest)) nearest = point;
  }
  return nearest;
}

function inferPace(scene: RadarScene, step: RadarStep): RadarPace {
  if (step.ball) return (step.ball.lift ?? 0) > 0 || scene.lift > 0 ? "air" : "pass";
  if (step.movers && Object.keys(step.movers).length > 0) return "run";
  return "hold";
}

interface StepTiming {
  ms: number;
  /** The runs that keep a pace of their own, at real pace. */
  runMs: Record<string, number>;
}

function runTimes(
  stage: RadarStage,
  scene: RadarScene,
  step: RadarStep,
  speed: number,
): Record<string, number> {
  const times: Record<string, number> = {};
  for (const [id, to] of Object.entries(step.movers ?? {})) {
    const from = standingIn(stage, scene, id) ?? to;
    times[id] = Math.max((distance(from, to) / speed) * 1000, MIN_RUN_MS);
  }
  return times;
}

/** The players a reset sends back into shape, and how long each takes at a jog. */
function returnTimes(
  stage: RadarStage,
  scene: RadarScene,
  step: RadarStep,
): Record<string, number> {
  if (!step.resetMovers) return {};
  const after = focusOf(applyStep(scene, step, 0));
  const times: Record<string, number> = {};
  for (const [id, at] of Object.entries(scene.movers)) {
    if (step.movers && id in step.movers) continue;
    const home = stage.positionAt(id, after);
    if (home) times[id] = Math.max((distance(at, home) / JOG_SPEED) * 1000, MIN_RUN_MS);
  }
  return times;
}

/**
 * How long `step` takes from `scene` at real pace. A ball in flight sets the
 * length and runners keep their own pace — they set off early to meet it, the
 * ball never waits. A carried ball moves with its carrier and the man
 * jockeying him, as one. With the ball still, the step lasts as long as the man
 * going to it needs.
 */
function stepTiming(stage: RadarStage, scene: RadarScene, step: RadarStep): StepTiming {
  const pace = step.pace ?? inferPace(scene, step);
  const returning = returnTimes(stage, scene, step);
  if (pace === "place" || pace === "hold") {
    const ms = pace === "place" ? PLACE_MS : HOLD_MS;
    return { ms, runMs: { ...returning, ...runTimes(stage, scene, step, PACE_SPEED.run) } };
  }
  const ballTravel = step.ball ? distance(scene.ball, step.ball.at) : 0;
  const runs = runTimes(stage, scene, step, pace === "carry" ? PACE_SPEED.carry : PACE_SPEED.run);
  const waited = (step.waitFor ?? Object.keys(runs)).map((id) => runs[id] ?? 0);
  const floor = step.overlay ? HOLD_MS : MIN_STEP_MS;
  let ms: number;
  if (pace === "carry") {
    ms = Math.max((ballTravel / PACE_SPEED.carry) * 1000, ...waited, 0);
  } else if (ballTravel > BALL_STILL_METRES) {
    ms = (ballTravel / PACE_SPEED[pace === "run" ? "pass" : pace]) * 1000;
  } else {
    ms = Math.max(0, ...waited);
  }
  ms = clamp(ms, floor, MAX_STEP_MS);
  if (pace === "carry") {
    // Those the carry waits for move in step with the ball; anyone else joining in keeps his own pace.
    for (const id of step.waitFor ?? Object.keys(runs)) runs[id] = ms;
  }
  return { ms, runMs: { ...returning, ...runs } };
}

/** Times each step from where the last one left the scene, and returns where they end. */
export function timeSteps(
  stage: RadarStage,
  scene: RadarScene,
  steps: RadarStep[],
): { stepMs: number[]; runMs: Record<string, number>[]; end: RadarScene } {
  const stepMs: number[] = [];
  const runMs: Record<string, number>[] = [];
  let current = scene;
  for (const step of steps) {
    const timing = stepTiming(stage, current, step);
    stepMs.push(timing.ms);
    runMs.push(timing.runMs);
    current = applyStep(current, step, 0);
  }
  return { stepMs, runMs, end: current };
}

// ---------------------------------------------------------------------------
// Keeping up with the match
// ---------------------------------------------------------------------------

/** A beat waiting to be played, its steps already scaled to the match speed. */
export interface QueuedBeat {
  beat: RadarBeat;
  stepMs: number[];
  /** Radar time per millisecond of real pace, for the runs that keep their own pace. */
  scale: number;
}

export function queueBeat(beat: RadarBeat, timeScale: number): QueuedBeat {
  return { beat, stepMs: beat.stepMs.map((ms) => ms * timeScale), scale: timeScale };
}

/** Step `index`'s own-pace runs of a queued beat, in radar time. */
export function queuedRuns(entry: QueuedBeat, index: number): Record<string, number> {
  const runs = entry.beat.runMs[index] ?? {};
  return Object.fromEntries(Object.entries(runs).map(([id, ms]) => [id, ms * entry.scale]));
}

function queuedMs(queue: QueuedBeat[]): number {
  return queue.reduce((sum, entry) => sum + entry.stepMs.reduce((a, b) => a + b, 0), 0);
}

/** The most the radar speeds a beat up to catch up; any faster and it stops looking real. */
const MAX_SPEED_UP = 1.3;

/**
 * Which queued beat to skip next to catch up, or -1 when only beats worth
 * keeping are left: tidy-ups first, then routine play, then final-third play.
 */
function nextToSkip(queue: QueuedBeat[]): number {
  const lastIndex = queue.length - 1;
  let latestAction = -1;
  for (let index = lastIndex; index >= 0; index--) {
    if (queue[index].beat.eventType !== "Settle") {
      latestAction = index;
      break;
    }
  }
  const isSkippable = (entry: QueuedBeat, index: number) =>
    !entry.beat.important && index !== lastIndex && index !== latestAction;
  const settle = queue.findIndex(
    (entry, index) => entry.beat.eventType === "Settle" && isSkippable(entry, index),
  );
  if (settle >= 0) return settle;
  const routine = queue.findIndex(
    (entry, index) => !entry.beat.prefer && isSkippable(entry, index),
  );
  return routine >= 0 ? routine : queue.findIndex(isSkippable);
}

/**
 * Keeps the radar no more than `maxLagMs` behind the match. Beats are never
 * hurried into a blur: tidy-up beats are skipped first, then the oldest routine
 * play, then final-third play — never a goal or a sending-off, never the latest
 * action, which is where the match is now — and only what is left is sped up,
 * by at most a third.
 */
export function trimBacklog(queue: QueuedBeat[], maxLagMs: number): QueuedBeat[] {
  const kept = [...queue];
  while (queuedMs(kept) > maxLagMs) {
    const skip = nextToSkip(kept);
    if (skip < 0) break;
    kept.splice(skip, 1);
  }
  const remaining = queuedMs(kept);
  if (remaining <= maxLagMs) return kept;
  const factor = Math.max(1 / MAX_SPEED_UP, maxLagMs / remaining);
  return kept.map((entry) => ({
    ...entry,
    stepMs: entry.stepMs.map((ms) => ms * factor),
    scale: entry.scale * factor,
  }));
}
