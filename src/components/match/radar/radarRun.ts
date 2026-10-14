import { type PitchPoint, type Side, distance, lerp } from "./radarGeometry";
import { type Playback, type PlayingStep, advancePlayback } from "./radarPlayback";
import type { QueuedBeat } from "./radarTiming";
import type { BallAction, RadarScene, RadarStep } from "./radarScene";
import {
  type Mark,
  type RadarSim,
  SIM_LIMITS,
  add,
  lengthOf,
  restingSim,
  scale,
  stepPlayers,
} from "./radarSim";
import type { RadarStage } from "./radarStage";
import { PACE_SPEED, meetingPoint } from "./radarTiming";

/**
 * The match radar run frame by frame: the script and the simulation together.
 *
 * The script says who does what with the ball; this decides when and exactly
 * where, from where the players really are. The ball always belongs somewhere:
 * at a man's feet (`held`), on its way to a man or a spot (`flight`), rolling
 * loose with someone going after it (`loose`), or out of play (`dead`). It
 * leaves a man's feet only when he is on it, a pass is aimed at where its
 * receiver can get to, a man going for a ball he cannot reach in time has it
 * rolled to him, and a ball out of play goes and comes back rather than
 * sliding across the pitch. A step that waits on the ball holds the script
 * until it is done.
 */

/** Where the ball sits in front of the man carrying it, centre to centre, in radar metres: on the edge of his dot. */
export const CARRY_OFFSET = 1.4;
/** Within this a man can strike the ball, take it, or take it off an opponent. */
export const REACH = 1.5;
/** How far from a receiver a pass that has arrived still counts as his. */
const RECEIVE_REACH = REACH;
/** A loose ball slows at this, metres a second per second. */
const FRICTION = 3.5;
/** How long a man is given to reach a still ball before it is rolled towards him. */
const TAKE_PATIENCE_S = 0.3;
/** How long a ball out of play takes to fade, and how long it stays hidden at least and at most. */
const DEAD_TIMING = { fade: 0.2, minHidden: 0.35, maxHidden: 1.2 };
/** The same, for a quick change of scene: the ball is back in a moment. */
const QUICK_TIMING = { fade: 0.15, minHidden: 0.1, maxHidden: 0.1 };
/** Players moving slower than this are taken to be in place for a restart. */
const IN_PLACE_SPEED = 3;
/** A step waiting on the ball is given up after this, so play never stalls. */
const MAX_ACTION_S = 4;
/** How fast the ball swings round the man carrying it as he turns, radians a second. */
const TURN_RATE = 5;
/** How fast the ball settles to its carrying distance, metres a second. */
const OFFSET_EASE = 3;
/** Longer frames than this are split, so a stalled tab does not throw players across the pitch. */
const MAX_SLICE_S = 1 / 30;

interface BallBase {
  at: PitchPoint;
  lift: number;
  opacity: number;
}

export type BallState = BallBase &
  (
    | { kind: "held"; holder: string; facing: PitchPoint; offset: number }
    | {
        kind: "flight";
        from: PitchPoint;
        to: PitchPoint;
        peak: number;
        startedAt: number;
        seconds: number;
        /** Who struck it, if anyone: he was on it when it left. */
        kicker: string | null;
        receiver: string | null;
        /** Where the receiver runs to meet it. */
        receiverMark: PitchPoint | null;
      }
    | { kind: "loose"; velocity: PitchPoint; chaser: string | null }
    | {
        kind: "dead";
        spot: PitchPoint;
        since: number;
        shownAt: number | null;
        quick: boolean;
        /** Who it comes back to, at his feet, facing this way. */
        holder: string | null;
        facing: PitchPoint;
        /** Who goes for it when it comes back lying loose. */
        chaser: string | null;
      }
  );

export interface RadarRun {
  playback: Playback;
  sim: RadarSim;
  ball: BallState;
  /** The step on screen whose action has begun: its beat, and which step of it. */
  acting: { beat: QueuedBeat; index: number } | null;
  /** When the step on screen came on, in simulation seconds. */
  since: number;
  /** Whether the step on screen's kick has been struck. */
  struck: boolean;
  /** Whether a still ball has been rolled to the man waiting for it, this step. */
  rolled: boolean;
  /** The script's marks, each with when its man must be on it. */
  marks: Record<string, Mark>;
}

function looseAt(at: PitchPoint): BallState {
  return { kind: "loose", at, lift: 0, opacity: 1, velocity: { x: 0, y: 0 }, chaser: null };
}

/** Everyone at rest where `playback` rests, the ball lying still. */
export function startRun(stage: RadarStage, playback: Playback): RadarRun {
  return {
    playback,
    sim: restingSim(stage, playback.scene),
    ball: looseAt(playback.scene.ball),
    acting: null,
    since: 0,
    struck: false,
    rolled: false,
    marks: {},
  };
}

/** The script step on screen, if any. */
function stepOnScreen(playback: Playback): RadarStep | null {
  return playback.step && playback.beat ? (playback.beat.beat.steps[playback.index] ?? null) : null;
}

function unit(vector: PitchPoint, fallback: PitchPoint): PitchPoint {
  const size = lengthOf(vector);
  return size > 1e-6 ? scale(vector, 1 / size) : fallback;
}

function towards(from: PitchPoint, to: PitchPoint): PitchPoint {
  return { x: to.x - from.x, y: to.y - from.y };
}

/** The ball at `holder`'s feet, facing towards it from him. */
function heldBy(holder: string, at: PitchPoint, ball: PitchPoint): BallState {
  const gap = distance(at, ball);
  return {
    kind: "held",
    holder,
    at: ball,
    lift: 0,
    opacity: 1,
    facing: unit(towards(at, ball), { x: 1, y: 0 }),
    offset: gap,
  };
}

/** A ball rolling from `at` so as to come to rest at `to`. */
function rollTo(at: PitchPoint, to: PitchPoint, chaser: string | null): BallState {
  const gap = distance(at, to);
  const speed = Math.sqrt(2 * FRICTION * gap);
  return {
    kind: "loose",
    at,
    lift: 0,
    opacity: 1,
    velocity: scale(unit(towards(at, to), { x: 0, y: 0 }), speed),
    chaser,
  };
}

/** The nearest of `side`'s players to `point`, keeper aside. */
function nearestOf(stage: RadarStage, sim: RadarSim, side: Side, point: PitchPoint): string | null {
  const keeper = stage.goalkeeper(side);
  let nearest: string | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const [id, player] of Object.entries(sim.players)) {
    if (stage.sideOf(id) !== side || id === keeper) continue;
    const gap = distance(player.at, point);
    if (gap < best) {
      best = gap;
      nearest = id;
    }
  }
  return nearest;
}

// ---------------------------------------------------------------------------
// Striking the ball
// ---------------------------------------------------------------------------

/**
 * The ball struck from where it is towards `to`. A receiver meets it where he
 * gets to in time from where he really is, and it is aimed to stop at his feet.
 */
function strike(
  ball: BallState,
  kicker: string | null,
  to: PitchPoint,
  pace: "pass" | "shot" | "air",
  peak: number,
  receiver: string | null,
  sim: RadarSim,
  time: number,
): BallState {
  const from = ball.at;
  const speed = PACE_SPEED[pace];
  const receiverAt = receiver ? sim.players[receiver]?.at : undefined;
  let target = to;
  let receiverMark: PitchPoint | null = null;
  if (receiver && receiverAt) {
    receiverMark = meetingPoint(receiverAt, to, (point) => distance(from, point) / speed, 0);
    const way = unit(towards(from, receiverMark), { x: 1, y: 0 });
    // It comes to rest just in front of him, on the side it came from.
    target =
      distance(from, receiverMark) > CARRY_OFFSET
        ? add(receiverMark, scale(way, -CARRY_OFFSET))
        : from;
  }
  return {
    kind: "flight",
    at: from,
    lift: 0,
    opacity: 1,
    from,
    to: target,
    peak,
    startedAt: time,
    seconds: Math.max(distance(from, target) / speed, 0.15),
    kicker,
    receiver,
    receiverMark,
  };
}

/** Who must get to the ball for `action` to go on, if the ball is not already his. */
function takerFor(action: BallAction | undefined): string | null {
  if (action?.kind === "take") return action.by;
  if (action?.kind === "kick") return action.by;
  return null;
}

/**
 * Puts the ball where the step's action needs it: struck when the man to
 * strike it has it; played to him by a team-mate who has it instead.
 */
function playIt(
  run: RadarRun,
  action: BallAction | undefined,
  stage: RadarStage,
  time: number,
): RadarRun {
  const { ball, sim } = run;
  const taker = takerFor(action);
  if (action?.kind === "kick" && !run.struck) {
    const isHis =
      action.by === null ? ball.kind !== "held" : ball.kind === "held" && ball.holder === action.by;
    if (isHis && ball.kind !== "flight" && ball.kind !== "dead") {
      return {
        ...run,
        struck: true,
        ball: strike(
          ball,
          action.by,
          action.to,
          action.pace,
          action.peak,
          action.receiver,
          sim,
          time,
        ),
      };
    }
  }
  // A team-mate has it: he plays it to the man who needs it.
  if (
    taker &&
    ball.kind === "held" &&
    ball.holder !== taker &&
    stage.sideOf(ball.holder) === stage.sideOf(taker)
  ) {
    return { ...run, ball: strike(ball, ball.holder, ball.at, "pass", 0, taker, sim, time) };
  }
  return run;
}

// ---------------------------------------------------------------------------
// Moving the ball
// ---------------------------------------------------------------------------

function turnTowards(facing: PitchPoint, wanted: PitchPoint, dt: number): PitchPoint {
  const from = Math.atan2(facing.y, facing.x);
  const to = Math.atan2(wanted.y, wanted.x);
  let gap = to - from;
  while (gap > Math.PI) gap -= 2 * Math.PI;
  while (gap < -Math.PI) gap += 2 * Math.PI;
  const turned = from + Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, gap));
  return { x: Math.cos(turned), y: Math.sin(turned) };
}

function moveBall(ball: BallState, sim: RadarSim, time: number, dt: number): BallState {
  switch (ball.kind) {
    case "held": {
      const holder = sim.players[ball.holder];
      if (!holder) return looseAt(ball.at);
      const moving = lengthOf(holder.velocity) > 1;
      const wanted = moving ? unit(holder.velocity, ball.facing) : ball.facing;
      const facing = turnTowards(ball.facing, wanted, dt);
      const offset =
        ball.offset +
        Math.max(-OFFSET_EASE * dt, Math.min(OFFSET_EASE * dt, CARRY_OFFSET - ball.offset));
      return { ...ball, facing, offset, at: add(holder.at, scale(facing, offset)) };
    }
    case "flight": {
      const progress = Math.min(1, (time - ball.startedAt) / ball.seconds);
      if (progress < 1) {
        return {
          ...ball,
          at: lerp(ball.from, ball.to, progress),
          lift: 4 * ball.peak * progress * (1 - progress),
        };
      }
      const receiverAt = ball.receiver ? sim.players[ball.receiver]?.at : undefined;
      if (ball.receiver && receiverAt && distance(receiverAt, ball.to) <= RECEIVE_REACH) {
        return heldBy(ball.receiver, receiverAt, ball.to);
      }
      // Arrived with no one on it: it runs on a little for whoever is going for it.
      const way = unit(towards(ball.from, ball.to), { x: 0, y: 0 });
      return {
        kind: "loose",
        at: ball.to,
        lift: 0,
        opacity: 1,
        velocity: ball.receiver ? scale(way, 2) : { x: 0, y: 0 },
        chaser: ball.receiver,
      };
    }
    case "loose": {
      const speed = lengthOf(ball.velocity);
      const slowed = Math.max(0, speed - FRICTION * dt);
      const velocity = speed > 1e-6 ? scale(ball.velocity, slowed / speed) : ball.velocity;
      return { ...ball, velocity, at: add(ball.at, scale(velocity, dt)) };
    }
    case "dead": {
      const timing = ball.quick ? QUICK_TIMING : DEAD_TIMING;
      const gone = time - ball.since;
      if (gone < timing.fade) return { ...ball, opacity: 1 - gone / timing.fade };
      const holderAt = ball.holder ? sim.players[ball.holder]?.at : undefined;
      if (ball.shownAt === null) {
        const hidden = gone - timing.fade;
        const settled = Object.values(sim.players).every(
          (player) => lengthOf(player.velocity) < IN_PLACE_SPEED,
        );
        const isBack = hidden >= timing.maxHidden || (hidden >= timing.minHidden && settled);
        // Coming back to a man, it comes back at his feet, on the side of where it was put.
        const facing = holderAt ? unit(towards(holderAt, ball.spot), { x: 1, y: 0 }) : ball.facing;
        const at = holderAt ? add(holderAt, scale(facing, CARRY_OFFSET)) : ball.spot;
        return { ...ball, at, facing, opacity: 0, shownAt: isBack ? time : null };
      }
      const at = holderAt ? add(holderAt, scale(ball.facing, CARRY_OFFSET)) : ball.spot;
      const shown = time - ball.shownAt;
      if (shown < timing.fade) return { ...ball, at, opacity: shown / timing.fade };
      if (ball.holder && holderAt) {
        return {
          kind: "held",
          holder: ball.holder,
          at,
          lift: 0,
          opacity: 1,
          facing: ball.facing,
          offset: CARRY_OFFSET,
        };
      }
      return {
        kind: "loose",
        at,
        lift: 0,
        opacity: 1,
        velocity: { x: 0, y: 0 },
        chaser: ball.chaser,
      };
    }
  }
}

/** A man going for the ball takes it once it is within his reach — off an opponent too. */
function pickUp(ball: BallState, sim: RadarSim, stage: RadarStage, takers: string[]): BallState {
  for (const taker of takers) {
    const at = sim.players[taker]?.at;
    if (!at || distance(at, ball.at) > REACH) continue;
    if (ball.kind === "loose") return heldBy(taker, at, ball.at);
    if (
      ball.kind === "held" &&
      ball.holder !== taker &&
      stage.sideOf(ball.holder) !== stage.sideOf(taker)
    ) {
      return heldBy(taker, at, ball.at);
    }
  }
  return ball;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** The script's marks for a new step: unchanged marks keep their deadline, new ones get one from now. */
function scriptMarks(
  previous: Record<string, Mark>,
  step: PlayingStep,
  time: number,
): Record<string, Mark> {
  const marks: Record<string, Mark> = {};
  for (const [id, at] of Object.entries(step.to.movers)) {
    const kept = previous[id];
    marks[id] =
      kept && distance(kept.at, at) < 0.01
        ? kept
        : { at, deadline: time + (step.to.runMs[id] ?? step.ms) / 1000 };
  }
  return marks;
}

/** What a step's action does to the ball as the step comes on. */
function beginAction(
  ball: BallState,
  action: BallAction | undefined,
  sim: RadarSim,
  stage: RadarStage,
  scene: RadarScene,
  time: number,
): BallState {
  if (action?.kind === "roll") {
    const chaser = action.chaser ?? nearestOf(stage, sim, scene.possession, action.to);
    return rollTo(ball.at, action.to, chaser);
  }
  if (action?.kind === "dead") {
    return {
      kind: "dead",
      at: ball.at,
      lift: 0,
      opacity: 1,
      spot: action.spot,
      since: time,
      shownAt: null,
      quick: action.quick ?? false,
      holder: action.holder ?? null,
      facing: { x: 1, y: 0 },
      chaser: action.chaser ?? null,
    };
  }
  return ball;
}

/** Whether a step that waits on the ball is done with it. */
function isDone(action: BallAction, run: RadarRun): boolean {
  const { ball } = run;
  switch (action.kind) {
    case "take":
      return ball.kind === "held" && ball.holder === action.by;
    case "kick":
      return run.struck && ball.kind !== "flight";
    case "roll":
      return (
        ball.kind === "held" ||
        (ball.kind === "loose" && !ball.chaser && lengthOf(ball.velocity) < 0.05)
      );
    case "dead":
      return ball.kind !== "dead";
    case "carry": {
      // The carrier is on his touch: the next one is never played before he gets there.
      const mark = run.marks[action.by];
      const at = run.sim.players[action.by]?.at;
      return !mark || !at || distance(at, mark.at) <= REACH;
    }
  }
}

/** The men the ball needs this frame, and where: the receiver of a pass, whoever is going for it. */
function ballMarks(
  run: RadarRun,
  action: BallAction | undefined,
  stage: RadarStage,
  time: number,
): Record<string, Mark> {
  const { ball, sim } = run;
  const marks: Record<string, Mark> = {};
  if (ball.kind === "flight" && ball.receiver && ball.receiverMark) {
    marks[ball.receiver] = { at: ball.receiverMark, deadline: ball.startedAt + ball.seconds };
  }
  const goers = new Set<string>();
  if (ball.kind === "loose" && ball.chaser) goers.add(ball.chaser);
  const taker = takerFor(action);
  const isComing = ball.kind === "flight" && ball.receiver === taker;
  const hasIt = ball.kind === "held" && ball.holder === taker;
  const teamMateHasIt =
    ball.kind === "held" && !!taker && stage.sideOf(ball.holder) === stage.sideOf(taker);
  if (taker && !isComing && !hasIt && !teamMateHasIt && ball.kind !== "dead") goers.add(taker);
  for (const id of goers) {
    const at = sim.players[id]?.at;
    if (at) marks[id] = { at: ball.at, deadline: time + distance(at, ball.at) / SIM_LIMITS.run };
  }
  return marks;
}

function advanceSlice(run: RadarRun, stage: RadarStage, dt: number, idle: boolean): RadarRun {
  const time = run.sim.time + dt;
  let next: RadarRun = run;
  if (!next.playback.step) next = { ...next, playback: advancePlayback(next.playback, 0) };
  const { playback } = next;
  const step = playback.step;
  const action = stepOnScreen(playback)?.action;
  const isNewStep =
    !!step &&
    !!playback.beat &&
    (next.acting?.beat !== playback.beat || next.acting.index !== playback.index);
  if (step && playback.beat && isNewStep) {
    next = {
      ...next,
      acting: { beat: playback.beat, index: playback.index },
      since: time,
      struck: false,
      rolled: false,
      marks: scriptMarks(next.marks, step, time),
      ball: beginAction(next.ball, action, next.sim, stage, playback.scene, time),
    };
  }
  next = playIt(next, action, stage, time);

  // A still ball the man going for it cannot reach in time is rolled towards him.
  const taker = takerFor(action);
  const takerAt = taker ? next.sim.players[taker]?.at : undefined;
  if (
    taker &&
    takerAt &&
    !next.rolled &&
    next.ball.kind === "loose" &&
    lengthOf(next.ball.velocity) < 1 &&
    time - next.since > TAKE_PATIENCE_S &&
    distance(takerAt, next.ball.at) > REACH
  ) {
    const halfway = lerp(next.ball.at, takerAt, 0.5);
    next = { ...next, rolled: true, ball: rollTo(next.ball.at, halfway, taker) };
  }

  const marks = { ...next.marks, ...ballMarks(next, action, stage, time) };
  // A man on the ball whom the script is not moving shields it where he stands:
  // his place in the shape never drags him off with it.
  const holderAt = next.ball.kind === "held" ? next.sim.players[next.ball.holder]?.at : undefined;
  if (next.ball.kind === "held" && holderAt && !(next.ball.holder in marks)) {
    marks[next.ball.holder] = { at: holderAt, deadline: time };
  }
  const sim = stepPlayers(next.sim, stage, playback.scene, next.ball.at, marks, dt, idle);
  let ball = moveBall(next.ball, sim, time, dt);
  const takers = [taker, ball.kind === "loose" ? ball.chaser : null].filter(
    (id): id is string => !!id,
  );
  ball = pickUp(ball, sim, stage, takers);
  next = { ...next, sim, ball };

  if (!step) return next;
  const isDoneOrGivenUp = !!action && (isDone(action, next) || time - next.since > MAX_ACTION_S);
  // A carry plays at its own pace, but holds at its end for a carrier left behind.
  const waitsForCarrier = action?.kind === "carry" && !isDoneOrGivenUp;
  const waitsOnBall = action && action.kind !== "carry";
  if (!waitsOnBall && !waitsForCarrier) {
    return { ...next, playback: advancePlayback(next.playback, dt * 1000) };
  }
  if (waitsOnBall && isDoneOrGivenUp) {
    return { ...next, playback: advancePlayback(next.playback, step.ms - step.elapsed) };
  }
  // Waiting on the ball: the script holds just short of the step's end.
  const elapsed = Math.min(step.elapsed + dt * 1000, step.ms * 0.999);
  return { ...next, playback: { ...next.playback, step: { ...step, elapsed } } };
}

/** The radar `dtMs` on, `run.playback` holding whatever has been queued since. */
export function advanceRun(
  run: RadarRun,
  stage: RadarStage,
  dtMs: number,
  { idle = true }: { idle?: boolean } = {},
): RadarRun {
  const seconds = Math.max(0, dtMs / 1000);
  const slices = Math.max(1, Math.ceil(seconds / MAX_SLICE_S));
  let next = run;
  for (let slice = 0; slice < slices; slice++) {
    next = advanceSlice(next, stage, seconds / slices, idle);
  }
  return next;
}
