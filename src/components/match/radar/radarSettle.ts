import {
  CENTRE_LANE,
  HALFWAY,
  PITCH_LENGTH,
  type PitchPoint,
  type Side,
  clamp,
  distance,
  fromPitch,
  opposite,
  zoneSpan,
} from "./radarGeometry";
import type { RadarScene, RadarStep } from "./radarScene";
import type { RadarStage } from "./radarStage";
import { TOUCH_AHEAD, ballCarrier, carryTouches, cast, nearestTo, only } from "./radarCasting";

/**
 * The end of a minute on the radar: the engine can leave the ball elsewhere, or
 * hand it to the other side, without an event of its own. These steps act that
 * out, so the ball always gets there with someone on it.
 */

/** Where the engine left the ball at the end of the batch. */
export interface RadarSettle {
  ballZone: string;
  possession: Side;
}

/** How far inside a zone's edge a settled ball is put, so it reads as in that zone. */
const SETTLE_INSET = 2;

/**
 * The engine handing the ball to the other side between events, with no event
 * of its own. The side on it gives it away — a pass that goes astray into the
 * zone the engine names — and the nearest of the other side, a midfielder for
 * preference, gets to it. If the ball stays where it is, the nearest of the
 * other side takes it off the man on it.
 */
function turnoverSteps(
  stage: RadarStage,
  scene: RadarScene,
  winners: Side,
  at: PitchPoint,
): RadarStep[] {
  const losers = opposite(winners);
  if (distance(at, scene.ball) < 1) {
    const winner = nearestTo(stage, scene, winners, scene.ball);
    return [
      {
        possession: winners,
        highlight: cast(winner),
        action: winner ? { kind: "take", by: winner } : undefined,
      },
    ];
  }
  const kicker = ballCarrier(stage, scene, losers) ?? nearestTo(stage, scene, losers, scene.ball);
  const recoverer =
    nearestTo(stage, scene, winners, at, "Midfielder") ?? nearestTo(stage, scene, winners, at);
  return [
    {
      ball: { at: scene.ball },
      movers: only(kicker, scene.ball),
      waitFor: cast(kicker),
      action: kicker ? { kind: "take", by: kicker } : undefined,
    },
    {
      pace: "air",
      ball: { at, lift: 0 },
      possession: winners,
      highlight: cast(kicker, recoverer),
      action: { kind: "kick", by: kicker, to: at, receiver: recoverer, pace: "air", peak: 1.5 },
    },
  ];
}

export function settleStepsFor(
  stage: RadarStage,
  scene: RadarScene,
  settle: RadarSettle,
): RadarStep[] | null {
  const ballInGoal = scene.ball.x < 0 || scene.ball.x > PITCH_LENGTH;
  const [from, to] = zoneSpan(settle.ballZone);
  const x = clamp(scene.ball.x, from + SETTLE_INSET, to - SETTLE_INSET);
  const ballMoves = ballInGoal || Math.abs(x - scene.ball.x) > SETTLE_INSET;
  const isTurnover = settle.possession !== scene.possession;
  if (!ballMoves && !isTurnover) return null;
  // After a goal the engine restarts from the centre spot.
  if (ballInGoal) {
    const centre = { x: HALFWAY, y: CENTRE_LANE };
    return [
      {
        ball: { at: centre, lift: 0 },
        resetMovers: true,
        possession: settle.possession,
        pace: "place",
        action: { kind: "dead", spot: centre },
      },
    ];
  }
  // Otherwise the ball is only nudged back into the zone the engine left it in — a zone is a wide band.
  const at = ballMoves ? { x, y: clamp(scene.ball.y, 10, 58) } : scene.ball;
  if (isTurnover) return turnoverSteps(stage, scene, settle.possession, at);
  // The side keeps it: the man on it, or the nearest, takes it there himself.
  const side = settle.possession;
  const onIt = ballCarrier(stage, scene, side);
  const carrier = onIt ?? nearestTo(stage, scene, side, scene.ball);
  if (!carrier) return null;
  const start = fromPitch(side, scene.movers[carrier] ?? scene.ball);
  const target = fromPitch(side, at);
  const take: RadarStep = {
    ball: { at: scene.ball },
    movers: only(carrier, scene.movers[carrier] ?? scene.ball),
    waitFor: [carrier],
    action: { kind: "take", by: carrier },
  };
  // A zone is a wide band: with the ball beyond it, he keeps it where it is
  // rather than carry it back towards his own goal.
  if (target.depth < fromPitch(side, scene.ball).depth) return onIt ? null : [take];
  return [
    take,
    ...carryTouches(side, carrier, start, { depth: target.depth - TOUCH_AHEAD, lane: target.lane }),
  ];
}

/**
 * A minute with nothing dangerous in it: the ball goes where the engine left
 * it in a moment — out of sight and back in that zone, the nearest man of the
 * side on it going for it — while the players drift on into shape. If it is
 * there already, a short pause, long enough to read the clock.
 */
export function quietSteps(stage: RadarStage, scene: RadarScene, settle: RadarSettle): RadarStep[] {
  const side = settle.possession;
  const [from, to] = zoneSpan(settle.ballZone);
  const isInZone = scene.ball.x >= from && scene.ball.x <= to;
  if (isInZone && scene.possession === side) {
    return [{ possession: side, highlight: [], overlay: null, pace: "place" }];
  }
  const at = {
    x: clamp(scene.ball.x, from + SETTLE_INSET, to - SETTLE_INSET),
    y: clamp(scene.ball.y, 10, 58),
  };
  const chaser = nearestTo(stage, scene, side, at);
  return [
    {
      ball: { at, lift: 0 },
      resetMovers: true,
      possession: side,
      highlight: [],
      overlay: null,
      pace: "place",
      action: { kind: "dead", spot: at, quick: true, chaser },
    },
  ];
}
