import type { MatchEvent } from "../types";
import {
  CENTRE_LANE,
  type PitchPoint,
  type ShapeFocus,
  type Side,
  distance,
  fromPitch,
  onPitch,
  opposite,
  seedOf,
  toPitch,
  zoneCentreX,
} from "./radarGeometry";
import { type RadarScene, type RadarStep, focusOf } from "./radarScene";
import { type LineGroup, type RadarStage, standingIn } from "./radarStage";

/**
 * Casting for the match radar's script: who stands in where the engine names
 * no one, who is nearest, who is on the ball — chosen deterministically so a
 * replay always looks the same — and how a man runs with the ball.
 */

/** -1…1 from a seed: a small, repeatable variation. */
export function jitter(seed: string): number {
  return ((seedOf(seed) % 2001) - 1000) / 1000;
}

/** Which line a side's ball arrives in when it moves into `zone`. */
export function lineFor(side: Side, zone: string): LineGroup {
  const depth = fromPitch(side, { x: zoneCentreX(zone), y: CENTRE_LANE }).depth;
  if (depth < 40) return "Defender";
  if (depth < 65) return "Midfielder";
  return "Forward";
}

export function standIn(
  stage: RadarStage,
  side: Side,
  group: LineGroup,
  seed: string,
  exclude: string | null,
): string | null {
  const candidates = stage.line(side, group).filter((id) => id !== exclude);
  const pool = candidates.length > 0 ? candidates : stage.line(side, "Midfielder");
  return pool.length > 0 ? pool[seedOf(seed) % pool.length] : null;
}

/** The nearest player of the side without the ball to `point`. */
export function nearestOpponent(
  stage: RadarStage,
  side: Side,
  point: PitchPoint,
  focus: ShapeFocus,
  lines?: LineGroup[],
): string | null {
  const defending = opposite(side);
  const eligible = lines ? new Set(lines.flatMap((group) => stage.line(defending, group))) : null;
  let nearest: string | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const [id, at] of stage.shapeAt(focus)) {
    if (stage.sideOf(id) !== defending || id === stage.goalkeeper(defending)) continue;
    if (eligible && !eligible.has(id)) continue;
    const gap = distance(at, point);
    if (gap < best) {
      best = gap;
      nearest = id;
    }
  }
  return nearest;
}

/** The engine names the man on the ball next; for a pass, he is the receiver. */
const ON_THE_BALL = new Set([
  "PassCompleted",
  "PassIntercepted",
  "Dribble",
  "DribbleTackled",
  "Cross",
  "ShotSaved",
  "ShotOffTarget",
  "ShotBlocked",
  "ShotOnTarget",
  "Goal",
]);

export function linkedReceiver(event: MatchEvent, next: MatchEvent | undefined): string | null {
  if (!next || next.side !== event.side || !ON_THE_BALL.has(next.event_type)) return null;
  return next.player_id && next.player_id !== event.player_id ? next.player_id : null;
}

/** Inline helper: the id list without nulls. */
export function cast(...ids: (string | null | undefined)[]): string[] {
  return ids.filter((id): id is string => !!id);
}

export function only(id: string | null | undefined, at: PitchPoint): Record<string, PitchPoint> {
  return id ? { [id]: at } : {};
}

/** The player running with the ball in `scene`, if one is. */
export function ballCarrier(stage: RadarStage, scene: RadarScene, side: Side): string | null {
  const carrier = Object.entries(scene.movers).find(
    ([id, at]) => stage.sideOf(id) === side && distance(at, scene.ball) <= TOUCH_AHEAD + 0.5,
  );
  return carrier?.[0] ?? null;
}

/** How far ahead of the runner each touch pushes the ball. */
export const TOUCH_AHEAD = 1.4;

/** The longest a single touch carries the ball. */
const TOUCH_METRES = 3.5;

/**
 * A run with the ball from `from` to `to` (both in `side`'s view), as touches
 * of at most a few metres: each pushes the ball a stride ahead and the runner
 * runs onto it, so ball and runner always travel together.
 */
export function carryTouches(
  side: Side,
  runner: string,
  from: { depth: number; lane: number },
  to: { depth: number; lane: number },
): RadarStep[] {
  const length = Math.hypot(to.depth - from.depth, to.lane - from.lane);
  const touches = Math.max(1, Math.ceil(length / TOUCH_METRES));
  return Array.from({ length: touches }, (_, index) => {
    const progress = (index + 1) / touches;
    const depth = from.depth + (to.depth - from.depth) * progress;
    const lane = from.lane + (to.lane - from.lane) * progress;
    return {
      pace: "carry" as const,
      ball: { at: onPitch(toPitch(side, depth + TOUCH_AHEAD, lane)), ease: "push" as const },
      movers: { [runner]: onPitch(toPitch(side, depth, lane)) },
      action: { kind: "carry" as const, by: runner },
    };
  });
}

/** The nearest of `side` to `point` as play stands in `scene`, keeper aside; from `group` if given. */
export function nearestTo(
  stage: RadarStage,
  scene: RadarScene,
  side: Side,
  point: PitchPoint,
  group?: LineGroup,
): string | null {
  const keeper = stage.goalkeeper(side);
  const pool = group
    ? stage.line(side, group)
    : [...stage.shapeAt(focusOf(scene)).keys()].filter(
        (id) => stage.sideOf(id) === side && id !== keeper,
      );
  let nearest: string | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const id of pool) {
    const gap = distance(standingIn(stage, scene, id) ?? point, point);
    if (gap < best) {
      best = gap;
      nearest = id;
    }
  }
  return nearest;
}
