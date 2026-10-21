import type { MatchEvent } from "../types";
import {
  BOX_HALF_WIDTH,
  CENTRE_LANE,
  GOAL_HALF_WIDTH,
  HALFWAY,
  LANE_BANDS,
  PITCH_LENGTH,
  PITCH_WIDTH,
  type PitchPoint,
  type ShapeFocus,
  type Side,
  clamp,
  distance,
  fromPitch,
  inLaneBand,
  inBox,
  lerp,
  onPitch,
  opposite,
  seedOf,
  toPitch,
  zoneAhead,
  zoneCentreX,
} from "./radarGeometry";
import {
  type RadarBeat,
  type RadarOverlay,
  type RadarScene,
  type RadarStep,
  focusOf,
} from "./radarScene";
import { type RadarStage, standingIn } from "./radarStage";
import { PACE_SPEED, crossingPoint, meetingPoint, paceSeconds, timeSteps } from "./radarTiming";
import {
  TOUCH_AHEAD,
  ballCarrier,
  carryTouches,
  cast,
  jitter,
  lineFor,
  linkedReceiver,
  nearestOpponent,
  nearestTo,
  only,
  standIn,
} from "./radarCasting";
import { captionsFor } from "./radarCaptions";
import { isAttackingPlay, movesOf } from "./radarHighlights";
import { type RadarSettle, isBallInGoal, quietSteps, settleStepsFor } from "./radarSettle";

/**
 * The match radar's director's script: turns the engine's events into short
 * animated beats. It acts out what the engine decided and never decides
 * anything itself — where the engine names no one (who receives a completed
 * pass), it casts a plausible stand-in from the right line, chosen
 * deterministically so a replay always looks the same.
 */

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

interface Cue {
  event: MatchEvent;
  next: MatchEvent | undefined;
  /** The event staged before it in the move, if any: a free kick, for the play that takes it. */
  previous?: MatchEvent;
  scene: RadarScene;
  stage: RadarStage;
}

interface Staging {
  steps: RadarStep[];
  /** Who the radar has receive the ball, for a beat that passes it: the commentary names him. */
  receiver?: string | null;
  /** Events used up, counting this one: an interception stages with its pass. */
  consumed?: number;
  important?: boolean;
}

/** Where `playerId` is drawn as the beat starts; the ball's spot when no one is named. */
function where(cue: Cue, playerId: string | null): PitchPoint {
  if (!playerId) return cue.scene.ball;
  return standingIn(cue.stage, cue.scene, playerId) ?? cue.scene.ball;
}

/** Where `playerId` would stand with the ball at `x`, `side` on it, in the lane it is in now. */
function shapeSpot(cue: Cue, playerId: string, x: number, side: Side): PitchPoint | null {
  return cue.stage.positionAt(playerId, { x, y: cue.scene.ball.y, possession: side });
}

function attackingBoxX(side: Side): number {
  return toPitch(side, 97, CENTRE_LANE).x;
}

/**
 * `lane` held inside the band of the event's lane, when it has one. An event's
 * `lane` is the ball's (protocol 3) or the actor's slot (protocol 2), so
 * either way the play is drawn in it (`LANE_BANDS`, phase 2, GĐ3).
 */
function inLaneOf(event: MatchEvent, lane: number): number {
  return inLaneBand(lane, event.lane);
}

/** The touchline a cross is struck from: its lane's, else the nearer one. */
function crossingFlank(event: MatchEvent, lane: number): number {
  if (event.lane === "Left") return 6;
  if (event.lane === "Right") return 62;
  return lane < CENTRE_LANE ? 6 : 62;
}

/** How far a player goes to a loose ball himself rather than having it come to him. */
const FETCH_METRES = 15;

/** How deep a cross down the wing is struck from, from the attacking side's end. */
const CROSS_DEPTH = 94;
/** A wide man this deep is close enough to the box to cross from where he is. */
const CROSS_FROM_HERE_DEPTH = 85;
/** A wide man this close to where he would cross from crosses from where he is. */
const CROSS_NEAR_METRES = 3;

/**
 * Where a cross is struck from. From a corner flag or a free kick, straight
 * in. A wide man already near the box, or past where an early cross goes in,
 * crosses from where he has the ball. Otherwise he runs down the wing to the
 * touchline of his lane first — but never back towards his own goal, and
 * never back out from the box to the touchline (after GĐ5).
 */
function crossingSpot(cue: Cue, at: PitchPoint, flank: number, early: boolean): PitchPoint {
  const side = cue.event.side;
  const { depth, lane } = fromPitch(side, at);
  const isSetPiece = depth >= CORNER_FLAG_DEPTH || cue.previous?.event_type === "FreeKick";
  if (isSetPiece) return at;
  const band = cue.event.lane === "Left" || cue.event.lane === "Right" ? cue.event.lane : null;
  const [centreFrom, centreTo] = LANE_BANDS.Centre;
  const isWide = band ? inLaneBand(lane, band) === lane : lane < centreFrom || lane > centreTo;
  const wantDepth = early ? EARLY_CROSS_DEPTH : CROSS_DEPTH;
  if (isWide && depth >= (early ? EARLY_CROSS_DEPTH : CROSS_FROM_HERE_DEPTH)) return at;
  const spot = toPitch(side, Math.max(depth, wantDepth), flank);
  return distance(spot, at) <= CROSS_NEAR_METRES ? at : spot;
}

interface Takeover {
  /** Where the actor has the ball. */
  at: PitchPoint;
  step: RadarStep;
  /** How long, at real pace, until he has it. */
  seconds: number;
}

/**
 * The first move of an attacking beat: its actor takes the ball. When it is
 * near he goes to it; when it is far — a stand-in had the last pass, or a
 * skipped beat left it elsewhere — it is played towards him and he comes to
 * meet it. The ball never jumps to a man, and no one else is put in place first.
 */
function takeBall(cue: Cue, actor: string | null): Takeover {
  const ball = cue.scene.ball;
  if (!actor) return { at: ball, step: { ball: { at: ball } }, seconds: 0 };
  const from = where(cue, actor);
  const gap = distance(from, ball);
  if (gap <= FETCH_METRES) {
    return {
      at: ball,
      step: {
        ball: { at: ball },
        movers: only(actor, ball),
        waitFor: [actor],
        action: { kind: "take", by: actor },
      },
      seconds: gap / PACE_SPEED.run,
    };
  }
  const at = meetingPoint(from, ball, (point) => distance(ball, point) / PACE_SPEED.pass, 0);
  return {
    at,
    step: {
      ball: { at, ease: "linear" },
      movers: only(actor, at),
      pace: "pass",
      action: { kind: "take", by: actor },
    },
    seconds: paceSeconds("pass", distance(ball, at)),
  };
}

/** Team-mates who join in when the ball is won: the nearest close it down, stopping short. */
const CLOSERS = 2;
const CLOSING_RANGE = 22;
const CLOSING_GAP = 3.5;

function closers(
  cue: Cue,
  side: Side,
  at: PitchPoint,
  winner: string | null,
): Record<string, PitchPoint> {
  const { stage } = cue;
  const keeper = stage.goalkeeper(side);
  const near = [...stage.shapeAt(focusOf(cue.scene)).keys()]
    .filter((id) => stage.sideOf(id) === side && id !== winner && id !== keeper)
    .map((id) => ({ id, from: where(cue, id) }))
    .map((entry) => ({ ...entry, gap: distance(entry.from, at) }))
    .filter(({ gap }) => gap > CLOSING_GAP && gap <= CLOSING_RANGE)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, CLOSERS);
  return Object.fromEntries(
    near.map(({ id, from, gap }) => [id, lerp(at, from, CLOSING_GAP / gap)]),
  );
}

/**
 * The first move of a defensive beat: the engine's man wins the ball, and the
 * nearest team-mates close it down with him. A long way off, the man on the
 * ball runs at him and they meet in between — a duel can happen anywhere in the
 * zone, and no one sprints thirty metres while the rest watch.
 */
function contestBall(cue: Cue): { at: PitchPoint; step: RadarStep } {
  const { event, scene, stage } = cue;
  const winner = event.player_id;
  const ball = scene.ball;
  const from = where(cue, winner);
  const isFar = !!winner && distance(from, ball) > FETCH_METRES;
  const at = isFar
    ? lerp(ball, from, PACE_SPEED.carry / (PACE_SPEED.carry + PACE_SPEED.run))
    : ball;
  const carrier = isFar ? ballCarrier(stage, scene, opposite(event.side)) : null;
  return {
    at,
    step: {
      ball: { at, lift: 0 },
      pace: isFar ? "carry" : undefined,
      movers: {
        ...only(carrier, at),
        ...closers(cue, event.side, at, winner),
        ...only(winner, at),
      },
      waitFor: cast(winner, carrier),
      highlight: cast(winner),
      possession: event.side,
      overlay: null,
      action: winner ? { kind: "take", by: winner } : undefined,
    },
  };
}

function stagePass(cue: Cue): Staging {
  const { event, next, stage } = cue;
  const side = event.side;
  const passer = event.player_id;
  const destination = zoneAhead(side, event.zone);
  const seed = `${event.minute}${passer}${event.zone}`;
  const receiver =
    linkedReceiver(event, next) ?? standIn(stage, side, lineFor(side, destination), seed, passer);
  const take = takeBall(cue, passer);
  const from = take.at;
  let to = toPitch(side, fromPitch(side, from).depth + 15, fromPitch(side, from).lane);
  if (receiver) {
    // He comes part of the way to meet the ball, setting off as the passer
    // takes it, and the ball is played to where he will be.
    const start = where(cue, receiver);
    const want = lerp(start, shapeSpot(cue, receiver, zoneCentreX(destination), side) ?? from, 0.4);
    to = meetingPoint(
      start,
      want,
      (point) => distance(from, point) / PACE_SPEED.pass,
      take.seconds,
    );
  }
  // A build-up or midfield pass stays in the lane the engine played it in
  // (phase 2, GĐ4).
  const aim = fromPitch(side, to);
  to = toPitch(side, aim.depth, inLaneOf(event, aim.lane));
  return {
    receiver,
    steps: [
      {
        ...take.step,
        resetMovers: true,
        overlay: null,
        movers: { ...take.step.movers, ...only(receiver, to) },
        highlight: cast(passer),
        possession: side,
      },
      {
        ball: { at: to, ease: "linear" },
        highlight: cast(passer, receiver),
        action: { kind: "kick", by: passer, to, receiver, pace: "pass", peak: 0 },
      },
    ],
  };
}

function stageInterceptedPass(cue: Cue): Staging {
  const { event, next, stage } = cue;
  const side = event.side;
  const passer = event.player_id;
  const interceptor = next?.event_type === "Interception" ? next.player_id : null;
  const destination = zoneAhead(side, event.zone);
  const target = standIn(
    stage,
    side,
    lineFor(side, destination),
    `${event.minute}${passer}`,
    passer,
  );
  const take = takeBall(cue, passer);
  const from = take.at;
  // Lost to a high press (phase 2, GĐ4): the pressers are on him as he plays it.
  const pressers =
    event.tactical_context === "HighTurnover"
      ? closers(cue, opposite(side), from, interceptor)
      : {};
  const aim = target ? (shapeSpot(cue, target, zoneCentreX(destination), side) ?? from) : from;
  // He reads it and gets across the ball's line where he can.
  const cut = interceptor
    ? crossingPoint(from, aim, where(cue, interceptor), take.seconds, PACE_SPEED.run, [0.35, 0.9])
    : lerp(from, aim, 0.55);
  return {
    consumed: next?.event_type === "Interception" ? 2 : 1,
    receiver: interceptor,
    steps: [
      {
        ...take.step,
        resetMovers: true,
        overlay: null,
        movers: { ...take.step.movers, ...pressers, ...only(interceptor, cut) },
        highlight: cast(passer),
        possession: side,
      },
      {
        ball: { at: cut, ease: "linear" },
        highlight: cast(passer, interceptor),
        action: { kind: "kick", by: passer, to: cut, receiver: interceptor, pace: "pass", peak: 0 },
      },
      { overlay: { kind: "cut", from, at: cut }, possession: opposite(side) },
    ],
  };
}

/** Where a long ball that drops short comes down, and where one over the midfield does. */
const LONG_BALL_SHORT_DEPTH = 55;
const LONG_BALL_OVER_DEPTH = 80;
/** How high a long ball flies at its peak, in metres. */
const LONG_BALL_PEAK = 12;

/**
 * A long ball out of the back (phase 2, GĐ4): the passer hits it high into
 * the lane the engine sent it down — into midfield when a loose ball follows
 * there, over it otherwise — and the man it is meant for runs onto it.
 */
function stageLongBall(cue: Cue): Staging {
  const { event, next } = cue;
  const side = event.side;
  const passer = event.player_id;
  const target = event.secondary_player_id;
  const take = takeBall(cue, passer);
  const short = next?.event_type === "BallRecovery" && next.zone === "Midfield";
  const depth = short ? LONG_BALL_SHORT_DEPTH : LONG_BALL_OVER_DEPTH;
  const landing = toPitch(side, depth, inLaneOf(event, fromPitch(side, take.at).lane));
  return {
    receiver: target,
    steps: [
      {
        ...take.step,
        resetMovers: true,
        overlay: null,
        movers: { ...take.step.movers, ...only(short ? null : target, landing) },
        highlight: cast(passer),
        possession: side,
      },
      {
        pace: "air",
        ball: { at: landing, lift: 0 },
        highlight: cast(passer, target),
        action: {
          kind: "kick",
          by: passer,
          to: landing,
          receiver: short ? null : target,
          pace: "air",
          peak: LONG_BALL_PEAK,
        },
      },
    ],
  };
}

/** How far a loose ball runs on before someone gets to it. */
const LOOSE_BALL_METRES = 4;

/**
 * A loose ball (phase 2, GĐ4): it runs on a few metres, the two men the engine
 * names go for it, and the winner comes away with it.
 */
function stageBallRecovery(cue: Cue): Staging {
  const { event, scene } = cue;
  const winner = event.player_id;
  const loser = event.secondary_player_id;
  const spin = jitter(`${event.minute}r${winner}`);
  const spot = onPitch({
    x: scene.ball.x + spin * LOOSE_BALL_METRES,
    y: scene.ball.y + (1 - Math.abs(spin)) * LOOSE_BALL_METRES * 0.5,
  });
  const beaten = lerp(spot, where(cue, loser), 0.15);
  return {
    steps: [
      {
        ball: { at: spot },
        movers: { ...only(loser, beaten), ...only(winner, spot) },
        waitFor: cast(winner),
        highlight: cast(winner, loser),
        overlay: null,
        action: { kind: "roll", to: spot, chaser: winner },
      },
      {
        ball: { at: spot },
        possession: event.side,
        highlight: cast(winner, loser),
        action: winner ? { kind: "take", by: winner } : undefined,
      },
    ],
  };
}

/** A defender wins the ball where it is, team-mates closing it down with him. */
function stageWinBack(cue: Cue): Staging {
  return { steps: [contestBall(cue).step] };
}

/** The shortest a dribble runs. */
const DRIBBLE_METRES = 10;
/**
 * Where a dribble ends: in the box, as the engine has it after one that comes
 * off, and well short of the keeper standing a few metres off his line.
 */
const DRIBBLE_END_DEPTH = 90;
const DRIBBLE_MAX_DEPTH = 93;
/** The longest a touch of a dribble carries the ball, and the fewest touches a dribble takes. */
const DRIBBLE_TOUCH_METRES = 3.5;
const DRIBBLE_MIN_TOUCHES = 3;
/** How far the run bends away from the defender at its widest. */
const DRIBBLE_BEND = 2.5;
/** How far goal-side the defender holds off the dribbler: a few metres, never on top of him. */
const JOCKEY_GAP = 6;
/** How far from the middle a wide man who cuts inside ends: the edge of the box. */
const CUT_INSIDE_LANE = 12;
/** How deep a break into an open flank carries the ball: into the box. */
const OPEN_FLANK_END_DEPTH = 90;
/**
 * On a break into an open flank, how far upfield of the runner the full back
 * who went up is caught, how far behind he still is when the run ends, and how
 * far in from the touchline he starts (phase 2, GĐ5 P5.6).
 */
const CAUGHT_UPFIELD = 15;
const STILL_CHASING = 3;
const FULL_BACK_TOUCHLINE = 8;
/** Where an early cross is struck from: well short of the byline. */
const EARLY_CROSS_DEPTH = 70;
/** Where a low cross is aimed: around the penalty spot. */
const LOW_CROSS_DEPTH = 93.5;

/**
 * A dribble, touch by touch: each touch pushes the ball a stride ahead and the
 * dribbler runs onto it, his run bending away from the nearest defender. The
 * defender jockeys goal-side, giving ground, until the last touch takes the
 * dribbler past him.
 */
function stageDribble(cue: Cue): Staging {
  const { event, stage } = cue;
  const side = event.side;
  const runner = event.player_id;
  const take = takeBall(cue, runner);
  const start = take.at;
  const taken = fromPitch(side, start);
  const depth = taken.depth;
  const lane = inLaneOf(event, taken.lane);
  const towardsMiddle = lane < CENTRE_LANE ? 1 : -1;
  // A wide man who cuts inside comes in to the edge of the box; one breaking
  // into a flank left open runs on into it (phase 2, GĐ3). Otherwise wide men
  // run down the line and the rest straight at goal, never back towards halfway.
  const endLane =
    event.tactical_context === "CutInside"
      ? CENTRE_LANE - towardsMiddle * CUT_INSIDE_LANE
      : event.tactical_context === "FlankExposed"
        ? CENTRE_LANE - towardsMiddle * BOX_HALF_WIDTH * 0.6
        : clamp(lane + (lane < 24 ? -4 : lane > 44 ? 4 : 0), 3, 65);
  const endDepth =
    event.tactical_context === "FlankExposed"
      ? Math.max(depth, OPEN_FLANK_END_DEPTH)
      : Math.max(depth, clamp(depth + DRIBBLE_METRES, DRIBBLE_END_DEPTH, DRIBBLE_MAX_DEPTH));
  const touchCount = Math.max(
    DRIBBLE_MIN_TOUCHES,
    Math.ceil(Math.hypot(endDepth - depth, endLane - lane) / DRIBBLE_TOUCH_METRES),
  );
  // A defender or midfielder steps up to him — not a forward caught upfield.
  const focus: ShapeFocus = { x: start.x, y: start.y, possession: side };
  // Into a flank left open, the full back who went up is caught upfield and
  // chases back; someone else steps up to the runner (phase 2, GĐ5 P5.6).
  const isOpenFlank = event.tactical_context === "FlankExposed";
  const flankLane = lane < CENTRE_LANE ? FULL_BACK_TOUCHLINE : PITCH_WIDTH - FULL_BACK_TOUCHLINE;
  const chaser = isOpenFlank
    ? nearestOpponent(stage, side, toPitch(side, depth, flankLane), focus, ["Defender"])
    : null;
  const defender = nearestOpponent(stage, side, start, focus, ["Defender", "Midfielder"], chaser);
  const chasing = (runDepth: number, progress: number) =>
    onPitch(
      toPitch(
        side,
        runDepth - STILL_CHASING - (CAUGHT_UPFIELD - STILL_CHASING) * (1 - progress),
        flankLane + (lane - flankLane) * progress * 0.5,
      ),
    );
  const defenderLane = defender ? fromPitch(side, where(cue, defender)).lane : lane + 1;
  // Bend away from the defender, but never towards a touchline he is already near.
  const awayFromDefender = defenderLane >= lane ? -1 : 1;
  const bend = lane < 8 ? 1 : lane > 60 ? -1 : awayFromDefender;

  const touches: RadarStep[] = [];
  for (let touch = 1; touch <= touchCount; touch++) {
    const progress = touch / touchCount;
    const runDepth = depth + (endDepth - depth) * progress;
    const runLane =
      lane + (endLane - lane) * progress + bend * DRIBBLE_BEND * Math.sin(Math.PI * progress);
    const feet = onPitch(toPitch(side, runDepth, runLane));
    const isLastTouch = touch === touchCount;
    // Goal-side and giving ground, then beaten: on the last touch the dribbler is past him.
    // Beaten, he turns aside where he stood rather than dropping back through the dribbler.
    const jockey = isLastTouch
      ? toPitch(side, runDepth - 1, runLane - bend * 6.5)
      : toPitch(side, runDepth + JOCKEY_GAP - progress * 1.8, runLane - bend * 1.2);
    touches.push({
      pace: "carry",
      ball: { at: onPitch(toPitch(side, runDepth + TOUCH_AHEAD, runLane)), ease: "push" },
      movers: {
        ...only(runner, feet),
        ...only(defender, onPitch(jockey)),
        ...only(chaser, chasing(runDepth, progress)),
      },
      highlight: cast(runner, defender),
      action: runner ? { kind: "carry", by: runner } : undefined,
    });
  }
  return {
    steps: [
      {
        ...take.step,
        resetMovers: true,
        overlay: null,
        // The defender squares up goal-side while the dribbler takes the ball.
        movers: {
          ...take.step.movers,
          ...only(defender, onPitch(toPitch(side, depth + JOCKEY_GAP + 1, lane - bend * 1.2))),
          ...only(chaser, chasing(depth, 0)),
        },
        highlight: cast(runner, defender),
        possession: side,
      },
      ...touches,
    ],
  };
}

function stageTackledDribble(cue: Cue): Staging {
  const { event, next } = cue;
  const side = event.side;
  const attacker = event.player_id;
  const pairedTackle = next?.event_type === "Tackle";
  const defender = event.secondary_player_id ?? (pairedTackle ? next?.player_id : null);
  const take = takeBall(cue, attacker);
  const taken = fromPitch(side, take.at);
  const depth = taken.depth;
  const lane = inLaneOf(event, taken.lane);
  return {
    consumed: pairedTackle ? 2 : 1,
    steps: [
      {
        ...take.step,
        resetMovers: true,
        overlay: null,
        highlight: cast(attacker),
        possession: side,
      },
      {
        movers: only(defender, toPitch(side, depth + 1.5, lane)),
        highlight: cast(attacker, defender),
      },
      {
        ball: { at: toPitch(side, depth - 3, lane) },
        possession: opposite(side),
        action: { kind: "roll", to: toPitch(side, depth - 3, lane), chaser: defender ?? null },
      },
    ],
  };
}

function stageCross(cue: Cue): Staging {
  const { event, stage } = cue;
  const side = event.side;
  const winger = event.player_id;
  const boxFocus: ShapeFocus = { x: attackingBoxX(side), y: cue.scene.ball.y, possession: side };
  const target =
    event.secondary_player_id ?? standIn(stage, side, "Forward", `${event.minute}x`, winger);
  const take = takeBall(cue, winger);
  const flank = crossingFlank(event, fromPitch(side, take.at).lane);
  // An early cross goes in from further back; a low one is driven along the
  // ground towards the penalty spot (phase 2, GĐ3).
  const early = event.tactical_context === "EarlyCross";
  const low = event.tactical_context === "LowCross";
  const flight = low ? "pass" : "air";
  const wingSpot = crossingSpot(cue, take.at, flank, early);
  const carry = paceSeconds("carry", distance(take.at, wingSpot));
  // The man it is aimed at sets off as the winger heads for the line, and the
  // ball is put where he will be.
  const want = toPitch(
    side,
    low ? LOW_CROSS_DEPTH : 95,
    CENTRE_LANE + (flank < CENTRE_LANE ? 3 : -3),
  );
  const landing = target
    ? meetingPoint(
        where(cue, target),
        want,
        (point) => distance(wingSpot, point) / PACE_SPEED[flight],
        take.seconds + carry,
      )
    : want;
  const marker = nearestOpponent(stage, side, landing, boxFocus);
  return {
    receiver: target,
    steps: [
      {
        ...take.step,
        resetMovers: true,
        overlay: null,
        highlight: cast(winger),
        possession: side,
      },
      {
        pace: "carry",
        ball: { at: wingSpot },
        movers: {
          ...only(winger, wingSpot),
          ...only(target, landing),
          ...only(marker, toPitch(side, 96.5, fromPitch(side, landing).lane)),
        },
        waitFor: cast(winger),
        highlight: cast(winger, target),
        action: winger ? { kind: "carry", by: winger } : undefined,
      },
      {
        pace: flight,
        ball: { at: landing, lift: 0 },
        action: {
          kind: "kick",
          by: winger,
          to: landing,
          receiver: target,
          pace: flight,
          peak: low ? 0 : 7,
        },
      },
    ],
  };
}

function stageClearance(cue: Cue): Staging {
  const delivered = cornerDelivery(cue);
  if (delivered) return delivered;
  const { event } = cue;
  const side = event.side;
  const won = contestBall(cue);
  const at = won.at;
  const out = onPitch(toPitch(side, 50 + jitter(`${event.minute}c`) * 8, fromPitch(side, at).lane));
  return {
    steps: [
      { ...won.step, possession: undefined },
      {
        pace: "air",
        ball: { at: out, lift: 0 },
        possession: side,
        action: {
          kind: "kick",
          by: event.player_id,
          to: out,
          receiver: null,
          pace: "air",
          peak: 5,
        },
      },
    ],
  };
}

/** How deep in the box a corner the engine clears at once is played to, from the attacking side's end. */
const CORNER_DELIVERY_DEPTH = 96;
/** How far either side of the middle a corner played to a defender lands, at most. */
const CORNER_DELIVERY_LANES = 10;

/**
 * A corner the engine clears with no cross named: the taker at the flag still
 * kicks it in, to the defender who clears it, rather than carry it in himself
 * (after GĐ5). Null when the ball is not at a corner flag.
 */
function cornerDelivery(cue: Cue): Staging | null {
  const { event, scene, stage } = cue;
  const side = event.side;
  const attacking = opposite(side);
  if (fromPitch(attacking, scene.ball).depth < CORNER_FLAG_DEPTH) return null;
  const taker = ballCarrier(stage, scene, attacking);
  const clearer = event.player_id;
  if (!taker || !clearer) return null;
  const lane = fromPitch(attacking, where(cue, clearer)).lane;
  const landing = toPitch(
    attacking,
    CORNER_DELIVERY_DEPTH,
    clamp(lane, CENTRE_LANE - CORNER_DELIVERY_LANES, CENTRE_LANE + CORNER_DELIVERY_LANES),
  );
  const out = onPitch(
    toPitch(side, 50 + jitter(`${event.minute}c`) * 8, fromPitch(side, landing).lane),
  );
  return {
    receiver: clearer,
    steps: [
      {
        pace: "air",
        ball: { at: landing, lift: 0 },
        movers: only(clearer, landing),
        highlight: cast(taker, clearer),
        overlay: null,
        action: { kind: "kick", by: taker, to: landing, receiver: clearer, pace: "air", peak: 4 },
      },
      {
        pace: "air",
        ball: { at: out, lift: 0 },
        possession: side,
        action: { kind: "kick", by: clearer, to: out, receiver: null, pace: "air", peak: 5 },
      },
    ],
  };
}

/** How deep in the box a shot is struck when the shooter has to be put there. */
const SHOT_DEPTH = 90;
/** How far inside the box's side lines a shooter carrying it in cuts to. */
const SHOT_LANE_INSET = 3;

/** Where the shooter takes the ball: at his feet if he has it, else laid into his path. */
function shootingSpot(cue: Cue, shooter: string | null): PitchPoint {
  const { scene } = cue;
  const side = cue.event.side;
  const from = where(cue, shooter);
  if (shooter && distance(from, scene.ball) <= TOUCH_AHEAD + 0.6) return from;
  const lane = fromPitch(side, from).lane;
  const want = toPitch(side, SHOT_DEPTH, CENTRE_LANE + (lane - CENTRE_LANE) * 0.45);
  if (!shooter) return want;
  return meetingPoint(from, want, (point) => distance(scene.ball, point) / PACE_SPEED.pass, 0);
}

/**
 * The shooter's way to where he strikes it: he takes the ball, and if that is
 * outside the box he carries it in first — the engine only ever shoots from
 * inside it.
 */
function shotApproach(cue: Cue, shooter: string | null): { steps: RadarStep[]; spot: PitchPoint } {
  const side = cue.event.side;
  const at = shootingSpot(cue, shooter);
  const take: RadarStep = {
    ball: { at, ease: "linear" },
    movers: only(shooter, at),
    highlight: cast(shooter),
    possession: side,
    overlay: null,
    action: shooter ? { kind: "take", by: shooter } : undefined,
  };
  if (!shooter || inBox(side, at)) return { steps: [take], spot: at };
  const from = fromPitch(side, at);
  const edge = BOX_HALF_WIDTH - SHOT_LANE_INSET;
  const carry = carryTouches(side, shooter, from, {
    depth: Math.max(SHOT_DEPTH - TOUCH_AHEAD, from.depth),
    lane: clamp(from.lane, CENTRE_LANE - edge, CENTRE_LANE + edge),
  });
  return { steps: [take, ...carry], spot: carry[carry.length - 1]?.ball?.at ?? at };
}

function stageShotFinish(cue: Cue, spot: PitchPoint, shooter: string | null): RadarStep[] {
  const { event, stage } = cue;
  const side = event.side;
  const spin = jitter(`${event.minute}${shooter}${event.event_type}`);
  const boxFocus: ShapeFocus = { x: attackingBoxX(side), y: spot.y, possession: side };
  switch (event.event_type) {
    case "Goal":
    case "PenaltyGoal":
      return celebrate(cue, spot, shooter, spin);
    case "ShotSaved": {
      const keeper = event.secondary_player_id ?? stage.goalkeeper(opposite(side));
      const save = toPitch(side, 101.5, CENTRE_LANE + spin * (GOAL_HALF_WIDTH - 1));
      return [
        {
          ball: { at: save, ease: "linear" },
          pace: "shot",
          movers: only(keeper, save),
          highlight: cast(shooter, keeper),
          possession: opposite(side),
          action: { kind: "kick", by: shooter, to: save, receiver: keeper, pace: "shot", peak: 0 },
        },
      ];
    }
    case "ShotBlocked": {
      const goal = toPitch(side, 105, CENTRE_LANE);
      const blocker = nearestOpponent(stage, side, lerp(spot, goal, 0.2), boxFocus);
      // He throws himself across the shot where he can get to it.
      const block = blocker
        ? crossingPoint(spot, goal, where(cue, blocker), 0.3, PACE_SPEED.run, [0.1, 0.5])
        : lerp(spot, goal, 0.2);
      const rebound = onPitch(toPitch(side, 80, fromPitch(side, spot).lane + spin * 10));
      return [
        {
          ball: { at: block, ease: "linear" },
          movers: only(blocker, block),
          pace: "shot",
          action: {
            kind: "kick",
            by: shooter,
            to: block,
            receiver: blocker,
            pace: "shot",
            peak: 0,
          },
        },
        {
          ball: { at: rebound },
          highlight: cast(shooter, blocker),
          action: { kind: "roll", to: rebound, chaser: null },
        },
      ];
    }
    default: {
      // Off target, or a missed penalty: past a post.
      const wide = toPitch(side, 107, CENTRE_LANE + (spin >= 0 ? 1 : -1) * (GOAL_HALF_WIDTH + 3));
      return [
        {
          ball: { at: wide, ease: "linear" },
          possession: opposite(side),
          pace: "shot",
          action: { kind: "kick", by: shooter, to: wide, receiver: null, pace: "shot", peak: 0 },
        },
      ];
    }
  }
}

function celebrate(cue: Cue, spot: PitchPoint, scorer: string | null, spin: number): RadarStep[] {
  const { event, stage } = cue;
  const side = event.side;
  const net = toPitch(side, 106.5, CENTRE_LANE + spin * (GOAL_HALF_WIDTH - 1.5));
  const huddle: Record<string, PitchPoint> = {};
  const teamMates = [...stage.shapeAt({ x: attackingBoxX(side), y: spot.y, possession: side })]
    .filter(([id]) => stage.sideOf(id) === side && id !== scorer && id !== stage.goalkeeper(side))
    .sort(([, a], [, b]) => distance(a, spot) - distance(b, spot))
    .slice(0, 4);
  teamMates.forEach(([id], index) => {
    const angle = (index / teamMates.length) * Math.PI * 2;
    huddle[id] = onPitch({
      x: spot.x + Math.cos(angle) * 2.6,
      y: spot.y + Math.sin(angle) * 2.6,
    });
  });
  return [
    {
      ball: { at: net, ease: "linear" },
      goal: side,
      highlight: cast(scorer),
      pace: "shot",
      action: { kind: "kick", by: scorer, to: net, receiver: null, pace: "shot", peak: 0 },
    },
    { movers: huddle },
  ];
}

/** How far out a direct free kick is struck from: about 25 m from goal. */
const FREE_KICK_DEPTH = 80;
/** How far either side of the middle a direct free kick is placed, at most. */
const FREE_KICK_LANE_SPREAD = 14;

/**
 * A shot straight from a free kick: the ball placed outside the box where the
 * foul gave it, the taker behind it, then the strike. Not carried in like a
 * shot from open play.
 */
function stageDirectFreeKick(cue: Cue): Staging {
  const side = cue.event.side;
  const taker = cue.event.player_id;
  const lane = clamp(
    fromPitch(side, cue.scene.ball).lane,
    CENTRE_LANE - FREE_KICK_LANE_SPREAD,
    CENTRE_LANE + FREE_KICK_LANE_SPREAD,
  );
  const spot = toPitch(side, FREE_KICK_DEPTH, lane);
  return {
    important: cue.event.event_type === "Goal",
    steps: [
      {
        // A new set piece: it may cut, and the ball is back at the taker's
        // feet on its spot once he is there (after GĐ5).
        sceneCut: true,
        overlay: null,
        ball: { at: spot },
        movers: only(taker, toPitch(side, FREE_KICK_DEPTH - TOUCH_AHEAD, lane)),
        highlight: cast(taker),
        possession: side,
        pace: "place",
        action: taker ? { kind: "dead", spot, holder: taker } : placed(cue, spot),
      },
      ...stageShotFinish(cue, spot, taker),
    ],
  };
}

/** The band a shot from distance is struck from: 20–30 m from goal. */
const LONG_SHOT_NEAREST = 79;
const LONG_SHOT_FARTHEST = 85;
/** How far either side of the middle a shot from distance is struck from, at most. */
const LONG_SHOT_LANE_SPREAD = 16;

/**
 * A shot from distance (phase 2, P2.5): the shooter takes it in his stride
 * where he meets the ball, 20–30 m out. Not carried into the box, and not
 * pulled back out of it either: a ball already in the box is struck from the
 * edge.
 */
/** Where a long shot from `from` is struck: within range of goal, never further out (after GĐ5). */
function longShotSpot(side: Side, from: PitchPoint): PitchPoint {
  const { depth, lane } = fromPitch(side, from);
  return toPitch(
    side,
    clamp(depth, LONG_SHOT_NEAREST, LONG_SHOT_FARTHEST),
    clamp(lane, CENTRE_LANE - LONG_SHOT_LANE_SPREAD, CENTRE_LANE + LONG_SHOT_LANE_SPREAD),
  );
}

/**
 * A long shot: the shooter takes the ball and, if he has it short of range,
 * carries it there before he strikes it — so it is never struck from where he
 * happened to get it, half a pitch out (after GĐ5).
 */
function stageLongShot(cue: Cue): Staging {
  const side = cue.event.side;
  const shooter = cue.event.player_id;
  const spot = longShotSpot(side, shooter ? where(cue, shooter) : cue.scene.ball);
  const take = takeBall(cue, shooter);
  const target = {
    depth: fromPitch(side, spot).depth - TOUCH_AHEAD,
    lane: fromPitch(side, spot).lane,
  };
  const touches = shooter ? carryTouches(side, shooter, fromPitch(side, take.at), target) : [];
  // However near the script has him, he carries it to the spot himself: on
  // screen he may still be short of it, and the carry waits for him there.
  const carry: RadarStep[] =
    shooter && touches.length === 0
      ? [
          {
            pace: "carry",
            ball: { at: spot },
            movers: only(shooter, toPitch(side, target.depth, target.lane)),
            waitFor: [shooter],
            action: { kind: "carry", by: shooter },
          },
        ]
      : touches;
  const struckFrom = carry[carry.length - 1]?.ball?.at ?? take.at;
  return {
    important: cue.event.event_type === "Goal",
    steps: [
      {
        ...take.step,
        highlight: cast(shooter),
        possession: side,
        overlay: null,
      },
      ...carry,
      ...stageShotFinish(cue, struckFrom, shooter),
    ],
  };
}

/**
 * How far out towards the shooter a keeper who came off his line stands when
 * the shot is struck past him, as a share of the way from his goal (phase 2,
 * GĐ5 P5.6).
 */
const KEEPER_OFF_LINE_SHARE = 0.6;

function stageShot(cue: Cue): Staging {
  if (cue.event.shot_kind === "DirectFreeKick") return stageDirectFreeKick(cue);
  if (cue.event.shot_kind === "LongRange") return stageLongShot(cue);
  const shooter = cue.event.player_id;
  const { steps, spot } = shotApproach(cue, shooter);
  const isGoal = cue.event.event_type === "Goal";
  const finish = stageShotFinish(cue, spot, shooter);
  if (cue.event.tactical_context !== "KeeperOffHisLine") {
    return { important: isGoal, steps: [...steps, ...finish] };
  }
  // He came for it and did not get there: out of his goal as the ball goes past him.
  const side = cue.event.side;
  const keeper = cue.stage.goalkeeper(opposite(side));
  const goal = toPitch(side, PITCH_LENGTH, CENTRE_LANE);
  const out = lerp(goal, spot, KEEPER_OFF_LINE_SHARE);
  const rushing = (step: RadarStep): RadarStep => ({
    ...step,
    movers: { ...step.movers, ...only(keeper, onPitch(out)) },
  });
  return { important: isGoal, steps: [...steps.map(rushing), ...finish.map(rushing)] };
}

function stagePenalty(cue: Cue): Staging {
  const side = cue.event.side;
  const taker = cue.event.player_id;
  const spot = toPitch(side, 94, CENTRE_LANE);
  return {
    important: cue.event.event_type === "PenaltyGoal",
    steps: [
      {
        resetMovers: true,
        overlay: null,
        ball: { at: spot },
        movers: only(taker, toPitch(side, 91, CENTRE_LANE)),
        highlight: cast(taker),
        pace: "place",
        action: placed(cue, spot),
      },
      ...stageShotFinish(cue, spot, taker),
    ],
  };
}

/** The ball placed for a restart: a corner, a goal kick, a penalty, the centre spot. */
function stageRestart(cue: Cue, at: PitchPoint, focusX: number, whistle = false): Staging {
  return {
    steps: [
      {
        focusX,
        resetMovers: true,
        clearTrail:
          cue.event.event_type === "KickOff" || cue.event.event_type === "SecondHalfStart",
        overlay: whistle ? { kind: "whistle", at } : null,
        ball: { at, lift: 0 },
        highlight: [],
        possession: cue.event.side,
        pace: "place",
        action: placed(cue, at),
      },
    ],
  };
}

/** A ball this deep, from the side's own goal line, lies at a corner flag. */
const CORNER_FLAG_DEPTH = 104;
/** Where the corner taker stands: just behind the ball, off the pitch, as deep as this. */
const CORNER_TAKER_DEPTH = 106;

/**
 * A corner: the ball out of play and back at the flag, at the feet of the man
 * who takes it, who goes there for it — so the cross that follows leaves from
 * his feet rather than off the flag on its own (after GĐ5).
 */
function stageCorner(cue: Cue, spot: PitchPoint): Staging {
  const { event } = cue;
  const restart = stageRestart(cue, spot, attackingBoxX(event.side));
  const taker = event.player_id;
  if (!taker) return restart;
  const behind = toPitch(event.side, CORNER_TAKER_DEPTH, fromPitch(event.side, spot).lane);
  return {
    steps: restart.steps.map((step) => ({
      ...step,
      // A new set piece: the players may be put in place for it rather than
      // run the length of the pitch to it (`radarSceneCut`).
      sceneCut: true,
      movers: only(taker, behind),
      highlight: cast(taker),
      action: { kind: "dead", spot, holder: taker },
    })),
  };
}

/**
 * A free kick: the whistle, and the man who takes it — named by the engine,
 * else the man who plays the ball next — goes to stand behind the ball, and
 * it comes back at his feet once he is there, so what follows is played from
 * where it lies rather than rolled to him (after GĐ5). A new set piece, so it
 * may cut (`radarSceneCut`).
 */
function stageFreeKick(cue: Cue): Staging {
  const { event, next, scene } = cue;
  const side = event.side;
  const whistle: RadarStep = {
    ball: ballAsStaged(cue),
    overlay: { kind: "whistle", at: scene.ball },
    possession: side,
  };
  // A direct free kick puts the ball on its own spot for the taker.
  if (next?.shot_kind === "DirectFreeKick") return { steps: [whistle] };
  const playsNext = next && next.side === side && isAttackingPlay(next) ? next.player_id : null;
  const taker = event.player_id ?? playsNext;
  if (!taker) return { steps: [whistle] };
  const { depth, lane } = fromPitch(side, scene.ball);
  return {
    steps: [
      {
        ...whistle,
        sceneCut: true,
        movers: only(taker, toPitch(side, depth - TOUCH_AHEAD, lane)),
        highlight: cast(taker),
        pace: "place",
        action: { kind: "dead", spot: scene.ball, holder: taker },
      },
    ],
  };
}

/** A ball put on its spot for a restart: out of play and back there, unless it is there already. */
function placed(cue: Cue, spot: PitchPoint): RadarStep["action"] {
  return distance(cue.scene.ball, spot) > 1 ? { kind: "dead", spot } : undefined;
}

/**
 * Where a beat that works from the ball as it lies puts it. Named, not left
 * implied: when a beat before it was skipped to catch up, the ball on screen is
 * somewhere else, and must come along rather than leave the play beside it.
 */
function ballAsStaged(cue: Cue): RadarStep["ball"] {
  return { at: cue.scene.ball, lift: cue.scene.lift };
}

function stageFoul(cue: Cue): Staging {
  const { event } = cue;
  const at = event.secondary_player_id ? where(cue, event.secondary_player_id) : cue.scene.ball;
  return {
    steps: [
      {
        ball: ballAsStaged(cue),
        movers: only(event.player_id, { x: at.x + 1.2, y: at.y + 1.2 }),
        overlay: { kind: "whistle", at },
        highlight: cast(event.player_id, event.secondary_player_id),
      },
    ],
  };
}

/** How far beyond the last defender a runner flagged offside is caught. */
const OFFSIDE_BEYOND = 2;

/**
 * A runner flagged offside (after GĐ5): the ball is played to him, a stride
 * beyond the last defender; the whistle goes, and the defence takes the free
 * kick where he was caught.
 */
function stageOffside(cue: Cue): Staging {
  const { event, stage } = cue;
  const side = event.side;
  const defending = opposite(side);
  const runner = event.player_id;
  const lastDefender = Math.max(
    ...stage.line(defending, "Defender").map((id) => fromPitch(side, where(cue, id)).depth),
    HALFWAY + 10,
  );
  const runnerLane = runner ? fromPitch(side, where(cue, runner)).lane : CENTRE_LANE;
  const caught = onPitch(
    toPitch(side, Math.min(lastDefender + OFFSIDE_BEYOND, 99), inLaneOf(event, runnerLane)),
  );
  const passer =
    ballCarrier(stage, cue.scene, side) ??
    nearestTo(stage, cue.scene, side, cue.scene.ball, "Midfielder");
  const take = takeBall(cue, passer);
  const taker = nearestTo(stage, cue.scene, defending, caught, "Defender");
  return {
    steps: [
      {
        ...take.step,
        resetMovers: true,
        overlay: null,
        movers: { ...take.step.movers, ...only(runner, caught) },
        highlight: cast(passer, runner),
        possession: side,
      },
      {
        ball: { at: caught, ease: "linear" },
        highlight: cast(passer, runner),
        action: { kind: "kick", by: passer, to: caught, receiver: runner, pace: "pass", peak: 0 },
      },
      {
        overlay: { kind: "whistle", at: caught },
        possession: defending,
        highlight: cast(runner),
        pace: "place",
        action: { kind: "dead", spot: caught, holder: taker },
      },
    ],
  };
}

function stageMarker(overlay: RadarOverlay, playerId: string | null, important = false): Staging {
  return { steps: [{ overlay, highlight: cast(playerId) }], important };
}

function stageEvent(cue: Cue): Staging | null {
  const { event } = cue;
  const side = event.side;
  const centre = { x: HALFWAY, y: CENTRE_LANE };
  switch (event.event_type) {
    case "PassCompleted":
      return stagePass(cue);
    case "PassIntercepted":
      return stageInterceptedPass(cue);
    case "LongBall":
      return stageLongBall(cue);
    case "BallRecovery":
      return stageBallRecovery(cue);
    case "Interception":
    case "Tackle":
      return stageWinBack(cue);
    case "Dribble":
      return stageDribble(cue);
    case "DribbleTackled":
      return stageTackledDribble(cue);
    case "Cross":
      return stageCross(cue);
    case "Clearance":
      return stageClearance(cue);
    case "Goal":
    case "ShotSaved":
    case "ShotOffTarget":
    case "ShotBlocked":
    case "ShotOnTarget":
      return stageShot(cue);
    case "PenaltyGoal":
    case "PenaltyMiss":
      return stagePenalty(cue);
    case "PenaltyAwarded": {
      const spot = toPitch(side, 94, CENTRE_LANE);
      return stageRestart(cue, spot, attackingBoxX(side), true);
    }
    case "Corner": {
      const flank = seedOf(`${event.minute}k`) % 2 === 0 ? 0.8 : 67.2;
      return stageCorner(cue, toPitch(side, 104.6, flank));
    }
    case "GoalKick":
      return stageRestart(cue, toPitch(side, 5.5, CENTRE_LANE + 9), toPitch(side, 25, 0).x);
    case "KickOff":
    case "SecondHalfStart":
      return stageRestart(cue, centre, HALFWAY);
    case "HalfTime":
    case "FullTime":
      return stageRestart(cue, centre, HALFWAY, true);
    case "Foul":
      return stageFoul(cue);
    case "Offside":
      return stageOffside(cue);
    case "FreeKick":
      return stageFreeKick(cue);
    case "YellowCard":
      return stageMarker(
        { kind: "card", playerId: event.player_id ?? "", colour: "yellow" },
        event.player_id,
      );
    case "RedCard":
    case "SecondYellow":
      // Never skipped: the man leaves the pitch, and the card is why.
      return stageMarker(
        { kind: "card", playerId: event.player_id ?? "", colour: "red" },
        event.player_id,
        true,
      );
    case "Injury":
      return stageMarker({ kind: "injury", playerId: event.player_id ?? "" }, event.player_id);
    default:
      // Substitutions show in the line-ups; shoot-out kicks have their own screen.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Final-third play: what the radar keeps when it has to catch up
// ---------------------------------------------------------------------------

/** Play near a goal by its nature. */
const FINAL_THIRD_ALWAYS = new Set([
  "Cross",
  "ShotSaved",
  "ShotOffTarget",
  "ShotBlocked",
  "ShotOnTarget",
  "PenaltyAwarded",
  "PenaltyMiss",
  "Corner",
]);
/** Attacking play, near a goal when it happens in the attacking third. */
const ATTACKING_PLAY = new Set(["Dribble", "DribbleTackled"]);
/** Defending play, near a goal when it happens in the defending side's own third. */
const DEFENDING_PLAY = new Set(["Foul", "FreeKick", "Clearance", "Tackle", "Interception"]);
/** How far from its own goal line a side's final third starts, in metres. */
const FINAL_THIRD_DEPTH = 70;

function isFinalThirdPlay(event: MatchEvent): boolean {
  if (FINAL_THIRD_ALWAYS.has(event.event_type)) return true;
  const depth = fromPitch(event.side, { x: zoneCentreX(event.zone), y: CENTRE_LANE }).depth;
  if (ATTACKING_PLAY.has(event.event_type)) return depth >= FINAL_THIRD_DEPTH;
  if (DEFENDING_PLAY.has(event.event_type)) return depth <= PITCH_LENGTH - FINAL_THIRD_DEPTH;
  return false;
}

/** Everyone the beat shows on the ball: its actor, the man it names, and the receiver it casts. */
function onTheBall(event: MatchEvent, staging: Staging): string[] {
  return cast(event.player_id, event.secondary_player_id, staging.receiver);
}

/**
 * Stage a batch of events — the events of one tick of the live match — from
 * `start`. Pass `settle` to end where the engine left the ball: possession can
 * change hands between events without an event of its own. `minute` is every
 * event of the minute when `events` are only the ones acted out, so the
 * commentary can still say what came before each.
 */
/**
 * How much of the ball's run both blocks follow on the break: the side that
 * lost the ball is still upfield, and the breaking side's team-mates are left
 * behind by the runner (phase 2, GĐ5 P5.6).
 */
const BREAK_FOLLOW = 0.4;

/** A staging played on the break: both shapes trail the ball instead of following it. */
function onTheBreak(staging: Staging, fromX: number): Staging {
  let focusX = fromX;
  const steps = staging.steps.map((step): RadarStep => {
    if (step.focusX !== undefined) {
      focusX = step.focusX;
      return step;
    }
    if (step.ball) focusX = fromX + (step.ball.at.x - fromX) * BREAK_FOLLOW;
    return { ...step, focusX };
  });
  return { ...staging, steps };
}

export function choreographBatch(
  events: MatchEvent[],
  stage: RadarStage,
  start: RadarScene,
  settle?: RadarSettle,
  minute: MatchEvent[] = events,
): { beats: RadarBeat[]; end: RadarScene } {
  const beats: RadarBeat[] = [];
  const seen = new Set<string>();
  let scene = start;
  let index = 0;
  while (index < events.length) {
    const event = events[index];
    const staged = stageEvent({
      event,
      next: events[index + 1],
      previous: events[index - 1],
      scene,
      stage,
    });
    const staging =
      staged && event.tactical_context === "Counter" ? onTheBreak(staged, scene.ball.x) : staged;
    if (staging) {
      const timed = timeSteps(stage, scene, staging.steps);
      beats.push({
        key: `${event.minute}-${index}-${event.event_type}`,
        eventType: event.event_type,
        steps: staging.steps,
        stepMs: timed.stepMs,
        runMs: timed.runMs,
        important: staging.important ?? false,
        prefer: isFinalThirdPlay(event),
        captions: captionsFor({
          event,
          previous: minute[minute.indexOf(event) - 1],
          receiver: staging.receiver ?? null,
          steps: staging.steps.length,
          seen,
        }),
      });
      for (const id of onTheBall(event, staging)) seen.add(id);
      scene = timed.end;
    }
    index += staging?.consumed ?? 1;
  }
  const settleSteps = settle ? settleStepsFor(stage, scene, settle) : null;
  if (settleSteps) {
    const timed = timeSteps(stage, scene, settleSteps);
    beats.push({
      key: `settle-${settle?.ballZone}-${settle?.possession}`,
      eventType: "Settle",
      steps: settleSteps,
      stepMs: timed.stepMs,
      runMs: timed.runMs,
      important: false,
      prefer: false,
    });
    scene = timed.end;
  }
  return { beats, end: scene };
}

/** A beat of `steps` staged from `scene`, timed. */
function beatOf(stage: RadarStage, scene: RadarScene, key: string, steps: RadarStep[]) {
  const timed = timeSteps(stage, scene, steps);
  const beat: RadarBeat = {
    key,
    eventType: "Settle",
    steps,
    stepMs: timed.stepMs,
    runMs: timed.runMs,
    important: false,
    prefer: false,
  };
  return { beat, end: timed.end };
}

/** How long the look at the block before a move lasts when it does not cut: a frame or two. */
const BLOCK_CHECK_MS = 120;

/**
 * The opening of a move started at the ball: nothing moves, but it is a
 * change of scene, so a block left behind by quiet minutes is put in place
 * before the move starts (`radarSceneCut`). Kept short, so a move that needs
 * no cut starts as it did.
 */
function blockCheck(stage: RadarStage, scene: RadarScene, minute: number) {
  const { beat, end } = beatOf(stage, scene, `block-check-${minute}`, [
    { sceneCut: true, pace: "place" },
  ]);
  return { beat: { ...beat, stepMs: [BLOCK_CHECK_MS] }, end };
}

/**
 * Stage what the 2D radar shows of a minute: its dangerous play only
 * (`highlightsOf`). A minute with none is a quick change of scene to where the
 * engine left the ball. A move that starts far from the ball opens with the
 * same quick change, the ball back at the feet of the man who starts it.
 */
export function choreographHighlights(
  events: MatchEvent[],
  stage: RadarStage,
  start: RadarScene,
  settle?: RadarSettle,
): { beats: RadarBeat[]; end: RadarScene } {
  const moves = movesOf(events);
  if (moves.length === 0) {
    if (!settle) return { beats: [], end: start };
    const quiet = beatOf(stage, start, `quiet-${settle.ballZone}`, quietSteps());
    return { beats: [quiet.beat], end: quiet.end };
  }
  const beats: RadarBeat[] = [];
  let scene = start;
  for (const move of moves) {
    const opening = openingOf(move[0], stage, scene);
    const played = choreographBatch(move, stage, opening.end, undefined, events);
    beats.push(opening.beat, ...played.beats);
    scene = played.end;
  }
  // The engine's tidy-up after the last move is too quick to be worth acting
  // out; only a goal's restart from the centre spot is shown.
  const restart = settle && isBallInGoal(scene) ? settleStepsFor(stage, scene, settle) : null;
  if (restart) {
    const kickOff = beatOf(stage, scene, `restart-${settle?.ballZone}`, restart);
    beats.push(kickOff.beat);
    scene = kickOff.end;
  }
  return { beats, end: scene };
}

/**
 * How a move opens: a change of scene (`radarSceneCut`). Started by the
 * attacking side playing the ball away from where it lies, the ball comes back
 * at the starter's feet in a moment; otherwise a short look at the block. A
 * restart or a card places the ball itself.
 */
function openingOf(first: MatchEvent, stage: RadarStage, scene: RadarScene) {
  const starter = isAttackingPlay(first) ? first.player_id : null;
  const standing = starter ? standingIn(stage, scene, starter) : null;
  // A move that is a long shot alone opens with the shooter in range.
  const starterAt =
    standing && first.shot_kind === "LongRange" ? longShotSpot(first.side, standing) : standing;
  if (!starter || !starterAt || distance(starterAt, scene.ball) <= FETCH_METRES) {
    return blockCheck(stage, scene, first.minute);
  }
  return beatOf(stage, scene, `lead-in-${first.minute}`, [
    {
      sceneCut: true,
      ball: { at: starterAt, lift: 0 },
      resetMovers: true,
      ...(starterAt !== standing ? { movers: only(starter, starterAt) } : {}),
      possession: first.side,
      highlight: [],
      overlay: null,
      pace: "place",
      action: { kind: "dead", spot: starterAt, quick: true, holder: starter },
    },
  ]);
}
