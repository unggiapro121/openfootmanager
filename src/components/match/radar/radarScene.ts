import type { MatchSnapshot } from "../types";
import {
  CENTRE_LANE,
  type PitchPoint,
  type ShapeFocus,
  type Side,
  distance,
  zoneCentreX,
} from "./radarGeometry";

/**
 * Where the match radar's script has play headed at one moment, and how one
 * step of a beat changes it. Pure data: the playback steps through it and the
 * simulation moves everyone towards it.
 */

/**
 * How a movement eases. `out` and `in` are the rise and fall of a ball in the
 * air; `push` is a touch on the ground — quick off the foot, then slowing.
 */
export type RadarEase = "linear" | "out" | "in" | "inOut" | "push";

/**
 * How fast a step moves, which sets how long it takes: a pass travels at pass
 * speed whatever the distance, a dribble at a running player's pace.
 */
export type RadarPace = "pass" | "shot" | "air" | "carry" | "run" | "place" | "hold";

export type RadarOverlay =
  /** A pass that never arrived: drawn from the passer to where it was cut out. */
  | { kind: "cut"; from: PitchPoint; at: PitchPoint }
  | { kind: "card"; playerId: string; colour: "yellow" | "red" }
  | { kind: "whistle"; at: PitchPoint }
  | { kind: "injury"; playerId: string };

/** Everything the radar draws at one moment. */
export interface RadarScene {
  ball: PitchPoint;
  /** How high the ball is in the air, in metres; drawn as an offset from its shadow. */
  lift: number;
  /** How the ball moves into this scene: along the ground on the step's curve, or rising and falling. */
  ballEase: RadarEase;
  /** Where along the pitch both blocks shape themselves around: the ball, unless a restart says otherwise. */
  focusX: number;
  /** Players acting out the beat, away from their place in the shape. */
  movers: Record<string, PitchPoint>;
  /**
   * How long each run the last step started takes: the man acting out the play
   * is on his mark when it says.
   */
  runMs: Record<string, number>;
  possession: Side;
  overlay: RadarOverlay | null;
  /** The players the beat is about: their names are always shown. */
  highlight: string[];
  /** Where the ball has just been, oldest first. */
  trail: PitchPoint[];
  /** The latest goal; `serial` changes with each so the celebration replays. */
  goal: { side: Side; serial: number } | null;
}

/** One movement within a beat. Fields left out keep their current value. */
export interface RadarStep {
  /** How fast it moves; inferred from what moves when left out. */
  pace?: RadarPace;
  ball?: { at: PitchPoint; lift?: number; ease?: RadarEase };
  /** Only for a restart, where the shapes form somewhere other than the ball. */
  focusX?: number;
  movers?: Record<string, PitchPoint>;
  /** Send every player back to his place in the shape before this step's movers. */
  resetMovers?: boolean;
  /**
   * Whose run the step lasts for when the ball does not fly: the man going to
   * the ball. Left out, every mover's. Team-mates joining in keep their own pace.
   */
  waitFor?: string[];
  clearTrail?: boolean;
  overlay?: RadarOverlay | null;
  highlight?: string[];
  possession?: Side;
  goal?: Side;
}

/** The staging of one engine event (or a pair the engine always emits together). */
export interface RadarBeat {
  key: string;
  eventType: string;
  steps: RadarStep[];
  /** How long each step takes at real pace, before the match speed is applied. */
  stepMs: number[];
  /** Each step's runs that keep their own pace, at real pace: player to milliseconds. */
  runMs: Record<string, number>[];
  /** A beat the radar never skips to catch up: a goal, a sending-off. */
  important: boolean;
  /** Final-third play, kept over routine play when the radar has to catch up. */
  prefer: boolean;
}

const TRAIL_LENGTH = 4;

export function initialRadarScene(snapshot: MatchSnapshot): RadarScene {
  const x = zoneCentreX(snapshot.ball_zone);
  return {
    ball: { x, y: CENTRE_LANE },
    lift: 0,
    ballEase: "inOut",
    focusX: x,
    movers: {},
    runMs: {},
    possession: snapshot.possession,
    overlay: null,
    highlight: [],
    trail: [],
    goal: null,
  };
}

/** What both shapes form around in `scene`. */
export function focusOf(scene: RadarScene): ShapeFocus {
  return { x: scene.focusX, y: scene.ball.y, possession: scene.possession };
}

/** The scene after `step`, its runs taking `runMs` (none: jump straight there). */
export function applyStep(
  scene: RadarScene,
  step: RadarStep,
  runMs: Record<string, number> = {},
): RadarScene {
  const movers = { ...(step.resetMovers ? {} : scene.movers), ...step.movers };
  const ball = step.ball?.at ?? scene.ball;
  const ballMoved = distance(ball, scene.ball) > 0.5;
  const trail = step.clearTrail
    ? []
    : ballMoved
      ? [...scene.trail, scene.ball].slice(-TRAIL_LENGTH)
      : scene.trail;
  // A carried ball and its carrier move as one: the same steady pace.
  const isCarry = step.pace === "carry";
  return {
    ball,
    lift: step.ball ? (step.ball.lift ?? 0) : scene.lift,
    ballEase: step.ball?.ease ?? (isCarry ? "linear" : "inOut"),
    // Both shapes follow the ball wherever it goes; only a restart sets them elsewhere.
    focusX: step.focusX ?? (step.ball ? ball.x : scene.focusX),
    movers,
    runMs,
    possession: step.possession ?? scene.possession,
    overlay: step.overlay === undefined ? scene.overlay : step.overlay,
    highlight: step.highlight ?? scene.highlight,
    trail,
    goal: step.goal ? { side: step.goal, serial: (scene.goal?.serial ?? 0) + 1 } : scene.goal,
  };
}
