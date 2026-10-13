import { type PitchPoint, type Side, clamp, distance, lerp, seedOf } from "./radarGeometry";
import type { Playback } from "./radarPlayback";
import { type RadarEase, type RadarScene, focusOf } from "./radarScene";
import { type RadarStage, scenePositions } from "./radarStage";

/**
 * The match radar frame by frame. The script (`radarPlayback`) says where the
 * ball goes and what the men acting out the play do; this works out where
 * everyone actually is, a frame at a time:
 *
 * - the ball follows the step on screen along its own curve;
 * - a man acting out the play runs to his mark so as to get there when the
 *   script says, never faster than a sprint;
 * - everyone else steers towards his place in the shape — around the ball as
 *   he saw it a moment ago, each with his own reaction time — with a top
 *   speed, a limit on how quickly he changes pace, and a little restless
 *   movement when play is quiet.
 *
 * Pure: the same frames in give the same pitch out.
 */

export const SIM_LIMITS = {
  /** The fastest anyone runs, metres a second. */
  sprint: 8.5,
  /** The fastest a man drifting into shape moves. */
  cruise: 7,
  /** How quickly a man drifting into shape changes speed, metres a second per second. */
  accel: 7,
  /** How long a man takes to close the last of the gap to his place: he eases in, never snaps. */
  arrive: 0.6,
};

/** Reaction times: the quickest in a side reacts this long after the ball, each next one a little later. */
const FIRST_REACTION_S = 0.12;
const REACTION_STEP_S = 0.045;
/** How long the ball's path is remembered: enough for the slowest reaction. */
const TRACK_S = 1.2;
/** Restless movement when play is quiet: how far a man shifts about his place, in metres. */
const IDLE_METRES = 0.7;
/** Longer frames than this are split, so a stalled tab does not throw players across the pitch. */
const MAX_FRAME_S = 1 / 30;

export interface SimPlayer {
  at: PitchPoint;
  velocity: PitchPoint;
  /** The mark a man acting out the play is running to, and when he must be there. */
  run: { target: PitchPoint; deadline: number } | null;
}

interface SeenBall {
  time: number;
  at: PitchPoint;
  possession: Side;
}

export interface RadarSim {
  /** Seconds since the simulation started. */
  time: number;
  ball: PitchPoint;
  lift: number;
  /** Where the ball has been lately, oldest first: what each man reacts to, a moment late. */
  track: SeenBall[];
  players: Record<string, SimPlayer>;
  /** Each man's reaction time, in seconds. */
  reactions: Record<string, number>;
}

/** Each side's players get reaction times a step apart, in an order that is stable but not the slot order. */
function reactionTimes(stage: RadarStage, ids: string[]): Record<string, number> {
  const times: Record<string, number> = {};
  for (const side of ["Home", "Away"] as const) {
    ids
      .filter((id) => stage.sideOf(id) === side)
      .sort((a, b) => seedOf(a) - seedOf(b))
      .forEach((id, rank) => {
        times[id] = FIRST_REACTION_S + rank * REACTION_STEP_S;
      });
  }
  return times;
}

/** Everyone standing still where `scene` puts them. */
export function restingSim(stage: RadarStage, scene: RadarScene): RadarSim {
  const positions = scenePositions(stage, scene);
  const players: Record<string, SimPlayer> = {};
  for (const [id, at] of positions) players[id] = { at, velocity: { x: 0, y: 0 }, run: null };
  return {
    time: 0,
    ball: scene.ball,
    lift: scene.lift,
    track: [{ time: 0, at: scene.ball, possession: scene.possession }],
    players,
    reactions: reactionTimes(stage, [...positions.keys()]),
  };
}

// ---------------------------------------------------------------------------
// The ball
// ---------------------------------------------------------------------------

/** The CSS easings the script names, as functions of progress 0…1. */
const EASE: Record<RadarEase, (t: number) => number> = {
  linear: (t) => t,
  out: (t) => 1 - (1 - t) ** 2,
  in: (t) => t * t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2),
  // Quick off the foot, then rolling to a stop.
  push: (t) => 1 - (1 - t) ** 3,
};

/** Where the ball is, and how high, partway through the step on screen. */
function ballNow(playback: Playback): { at: PitchPoint; lift: number } {
  const { step } = playback;
  if (!step) return { at: playback.scene.ball, lift: playback.scene.lift };
  const t = step.ms > 0 ? clamp(step.elapsed / step.ms, 0, 1) : 1;
  const { ballEase } = step.to;
  // In the air the ball's shadow travels steadily while it rises and falls on
  // its own curve; on the ground both share the step's easing.
  const isAerial = ballEase === "out" || ballEase === "in";
  const ground = isAerial ? EASE.linear(t) : EASE[ballEase](t);
  const height = EASE[ballEase](t);
  return {
    at: lerp(step.from.ball, step.to.ball, ground),
    lift: step.from.lift + (step.to.lift - step.from.lift) * height,
  };
}

/** The ball as a man saw it `delay` seconds ago. */
function seenBall(track: SeenBall[], time: number): SeenBall {
  let seen = track[0];
  for (const entry of track) {
    if (entry.time > time) break;
    seen = entry;
  }
  return seen;
}

// ---------------------------------------------------------------------------
// The players
// ---------------------------------------------------------------------------

function add(a: PitchPoint, b: PitchPoint): PitchPoint {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(a: PitchPoint, factor: number): PitchPoint {
  return { x: a.x * factor, y: a.y * factor };
}

function lengthOf(a: PitchPoint): number {
  return Math.hypot(a.x, a.y);
}

function limit(a: PitchPoint, max: number): PitchPoint {
  const size = lengthOf(a);
  return size > max ? scale(a, max / size) : a;
}

/** A man acting out the play: straight to his mark, timed to arrive when the script says. */
function runToMark(
  player: SimPlayer,
  target: PitchPoint,
  runMs: number,
  stepStarted: number,
  time: number,
  dt: number,
): SimPlayer {
  const isSameMark = player.run && distance(player.run.target, target) < 0.01;
  const run =
    isSameMark && player.run ? player.run : { target, deadline: stepStarted + runMs / 1000 };
  const gap = distance(player.at, target);
  if (gap < 1e-6) return { at: target, velocity: { x: 0, y: 0 }, run };
  const remaining = run.deadline - time;
  const speed = Math.min(remaining > dt ? gap / remaining : SIM_LIMITS.sprint, SIM_LIMITS.sprint);
  const step = Math.min(gap, speed * dt);
  const at = lerp(player.at, target, step / gap);
  return { at, velocity: scale({ x: at.x - player.at.x, y: at.y - player.at.y }, 1 / dt), run };
}

/** A small, smooth wander about a man's place: two slow waves out of step with each other's. */
function restless(id: string, time: number): PitchPoint {
  const seed = seedOf(id);
  const slow = 5 + (seed % 300) / 100;
  const quick = 2.3 + ((seed >> 4) % 170) / 100;
  const phase = (seed % 628) / 100;
  return {
    x:
      IDLE_METRES *
      (Math.sin((2 * Math.PI * time) / slow + phase) +
        0.5 * Math.sin((2 * Math.PI * time) / quick)),
    y:
      IDLE_METRES *
      (Math.cos((2 * Math.PI * time) / (slow * 1.3) + phase) +
        0.5 * Math.sin((2 * Math.PI * time) / (quick * 0.8) + 1)),
  };
}

/** Steering towards `target` with a top speed, an easing-in on arrival and a limit on change of pace. */
function steer(player: SimPlayer, target: PitchPoint, dt: number): SimPlayer {
  const toTarget = { x: target.x - player.at.x, y: target.y - player.at.y };
  const gap = lengthOf(toTarget);
  const wanted =
    gap > 1e-6
      ? scale(toTarget, Math.min(SIM_LIMITS.cruise, gap / SIM_LIMITS.arrive) / gap)
      : { x: 0, y: 0 };
  const change = limit(
    { x: wanted.x - player.velocity.x, y: wanted.y - player.velocity.y },
    SIM_LIMITS.accel * dt,
  );
  const velocity = limit(add(player.velocity, change), SIM_LIMITS.cruise);
  return { at: add(player.at, scale(velocity, dt)), velocity, run: null };
}

function advanceFrame(
  sim: RadarSim,
  stage: RadarStage,
  playback: Playback,
  dt: number,
  idle: boolean,
): RadarSim {
  const time = sim.time + dt;
  const scene = playback.scene;
  const ball = ballNow(playback);
  const track = [...sim.track, { time, at: ball.at, possession: scene.possession }].filter(
    (entry, index, all) => index === all.length - 1 || time - entry.time <= TRACK_S,
  );
  const followsBall = Math.abs(scene.focusX - scene.ball.x) < 1e-6;
  const stepStarted = time - (playback.step?.elapsed ?? 0) / 1000;
  const ids = [...stage.shapeAt(focusOf(scene)).keys()];
  const reactions = ids.every((id) => id in sim.reactions)
    ? sim.reactions
    : reactionTimes(stage, ids);

  const players: Record<string, SimPlayer> = {};
  for (const id of ids) {
    const seen = seenBall(track, time - (reactions[id] ?? FIRST_REACTION_S));
    const focus = {
      x: followsBall ? seen.at.x : scene.focusX,
      y: seen.at.y,
      possession: seen.possession,
    };
    const place = stage.positionAt(id, focus);
    const player = sim.players[id] ?? { at: place ?? ball.at, velocity: { x: 0, y: 0 }, run: null };
    const mark = scene.movers[id];
    if (mark) {
      const runMs = scene.runMs[id] ?? playback.step?.ms ?? 0;
      players[id] = runToMark(player, mark, runMs, stepStarted, time, dt);
      continue;
    }
    if (!place) continue;
    const target = idle ? add(place, restless(id, time)) : place;
    players[id] = steer(player, target, dt);
  }
  return { time, ball: ball.at, lift: ball.lift, track, players, reactions };
}

/** The pitch `dtMs` later, with `playback` already advanced to that moment. */
export function stepSim(
  sim: RadarSim,
  stage: RadarStage,
  playback: Playback,
  dtMs: number,
  { idle = true }: { idle?: boolean } = {},
): RadarSim {
  const seconds = Math.max(0, dtMs / 1000);
  const slices = Math.max(1, Math.ceil(seconds / MAX_FRAME_S));
  let next = sim;
  for (let slice = 0; slice < slices; slice++) {
    next = advanceFrame(next, stage, playback, seconds / slices, idle);
  }
  return next;
}
