import { type PitchPoint, type Side, distance, lerp, seedOf } from "./radarGeometry";
import { type RadarScene, focusOf } from "./radarScene";
import { type RadarStage, scenePositions } from "./radarStage";

/**
 * The match radar's 22 players, frame by frame. Where the ball is and who must
 * be where come from outside (`radarRun`); this moves everyone:
 *
 * - a man with a mark runs to it so as to be there by its deadline, never
 *   faster than a sprint;
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
  /** A man's ordinary running pace, metres a second: how fast he goes to the ball. */
  run: 7,
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

export interface SimPlayer {
  at: PitchPoint;
  velocity: PitchPoint;
}

/** Where a man must be, and by when (simulation seconds). */
export interface Mark {
  at: PitchPoint;
  deadline: number;
}

interface SeenBall {
  time: number;
  at: PitchPoint;
  possession: Side;
}

export interface RadarSim {
  /** Seconds since the simulation started. */
  time: number;
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
  for (const [id, at] of positions) players[id] = { at, velocity: { x: 0, y: 0 } };
  return {
    time: 0,
    track: [{ time: 0, at: scene.ball, possession: scene.possession }],
    players,
    reactions: reactionTimes(stage, [...positions.keys()]),
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
// Vectors
// ---------------------------------------------------------------------------

export function add(a: PitchPoint, b: PitchPoint): PitchPoint {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(a: PitchPoint, factor: number): PitchPoint {
  return { x: a.x * factor, y: a.y * factor };
}

export function lengthOf(a: PitchPoint): number {
  return Math.hypot(a.x, a.y);
}

function limit(a: PitchPoint, max: number): PitchPoint {
  const size = lengthOf(a);
  return size > max ? scale(a, max / size) : a;
}

// ---------------------------------------------------------------------------
// The players
// ---------------------------------------------------------------------------

/** A man with a mark: straight to it, timed to arrive by its deadline, never faster than a sprint. */
function runToMark(player: SimPlayer, mark: Mark, time: number, dt: number): SimPlayer {
  const gap = distance(player.at, mark.at);
  if (gap < 1e-6) return { at: mark.at, velocity: { x: 0, y: 0 } };
  const remaining = mark.deadline - time;
  const speed = Math.min(remaining > dt ? gap / remaining : SIM_LIMITS.sprint, SIM_LIMITS.sprint);
  const step = Math.min(gap, speed * dt);
  const at = lerp(player.at, mark.at, step / gap);
  return { at, velocity: scale({ x: at.x - player.at.x, y: at.y - player.at.y }, 1 / dt) };
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
  return { at: add(player.at, scale(velocity, dt)), velocity };
}

/**
 * Everyone `dt` seconds on: those with a mark run to it, the rest steer into
 * shape around the ball at `ball`, as each of them saw it a moment ago.
 */
export function stepPlayers(
  sim: RadarSim,
  stage: RadarStage,
  scene: RadarScene,
  ball: PitchPoint,
  marks: Record<string, Mark>,
  dt: number,
  idle: boolean,
): RadarSim {
  const time = sim.time + dt;
  const track = [...sim.track, { time, at: ball, possession: scene.possession }].filter(
    (entry, index, all) => index === all.length - 1 || time - entry.time <= TRACK_S,
  );
  const followsBall = Math.abs(scene.focusX - scene.ball.x) < 1e-6;
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
    const player = sim.players[id] ?? { at: place ?? ball, velocity: { x: 0, y: 0 } };
    const mark = marks[id];
    if (mark) {
      players[id] = runToMark(player, mark, time, dt);
      continue;
    }
    if (!place) continue;
    const target = idle ? add(place, restless(id, time)) : place;
    players[id] = steer(player, target, dt);
  }
  return { time, track, players, reactions };
}
