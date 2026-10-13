import type { MatchEvent } from "../types";
import {
  CENTRE_LANE,
  GOAL_HALF_WIDTH,
  HALFWAY,
  PITCH_LENGTH,
  type PitchPoint,
  type ShapeFocus,
  type Side,
  clamp,
  distance,
  fromPitch,
  lerp,
  onPitch,
  opposite,
  seedOf,
  toPitch,
  zoneAhead,
  zoneCentreX,
  zoneSpan,
} from "./radarGeometry";
import {
  type RadarBeat,
  type RadarOverlay,
  type RadarScene,
  type RadarStep,
  focusOf,
} from "./radarScene";
import { type LineGroup, type RadarStage, standingIn } from "./radarStage";
import { PACE_SPEED, crossingPoint, meetingPoint, paceSeconds, timeSteps } from "./radarTiming";

/**
 * The match radar's director's script: turns the engine's events into short
 * animated beats. It acts out what the engine decided and never decides
 * anything itself — where the engine names no one (who receives a completed
 * pass), it casts a plausible stand-in from the right line, chosen
 * deterministically so a replay always looks the same.
 */

// ---------------------------------------------------------------------------
// Casting helpers
// ---------------------------------------------------------------------------

/** -1…1 from a seed: a small, repeatable variation. */
function jitter(seed: string): number {
  return ((seedOf(seed) % 2001) - 1000) / 1000;
}

/** Which line a side's ball arrives in when it moves into `zone`. */
function lineFor(side: Side, zone: string): LineGroup {
  const depth = fromPitch(side, { x: zoneCentreX(zone), y: CENTRE_LANE }).depth;
  if (depth < 40) return "Defender";
  if (depth < 65) return "Midfielder";
  return "Forward";
}

function standIn(
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
function nearestOpponent(
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

function linkedReceiver(event: MatchEvent, next: MatchEvent | undefined): string | null {
  if (!next || next.side !== event.side || !ON_THE_BALL.has(next.event_type)) return null;
  return next.player_id && next.player_id !== event.player_id ? next.player_id : null;
}

/** Inline helper: the id list without nulls. */
function cast(...ids: (string | null | undefined)[]): string[] {
  return ids.filter((id): id is string => !!id);
}

function only(id: string | null | undefined, at: PitchPoint): Record<string, PitchPoint> {
  return id ? { [id]: at } : {};
}

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

interface Cue {
  event: MatchEvent;
  next: MatchEvent | undefined;
  scene: RadarScene;
  stage: RadarStage;
}

interface Staging {
  steps: RadarStep[];
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

/** How far a player goes to a loose ball himself rather than having it come to him. */
const FETCH_METRES = 15;

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
      step: { ball: { at: ball }, movers: only(actor, ball), waitFor: [actor] },
      seconds: gap / PACE_SPEED.run,
    };
  }
  const at = meetingPoint(from, ball, (point) => distance(ball, point) / PACE_SPEED.pass, 0);
  return {
    at,
    step: { ball: { at, ease: "linear" }, movers: only(actor, at), pace: "pass" },
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

/** The player running with the ball in `scene`, if one is. */
function ballCarrier(stage: RadarStage, scene: RadarScene, side: Side): string | null {
  const carrier = Object.entries(scene.movers).find(
    ([id, at]) => stage.sideOf(id) === side && distance(at, scene.ball) <= TOUCH_AHEAD + 0.5,
  );
  return carrier?.[0] ?? null;
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
  return {
    steps: [
      {
        ...take.step,
        resetMovers: true,
        overlay: null,
        movers: { ...take.step.movers, ...only(receiver, to) },
        highlight: cast(passer),
        possession: side,
      },
      { ball: { at: to, ease: "linear" }, highlight: cast(passer, receiver) },
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
  const aim = target ? (shapeSpot(cue, target, zoneCentreX(destination), side) ?? from) : from;
  // He reads it and gets across the ball's line where he can.
  const cut = interceptor
    ? crossingPoint(from, aim, where(cue, interceptor), take.seconds, PACE_SPEED.run, [0.35, 0.9])
    : lerp(from, aim, 0.55);
  return {
    consumed: next?.event_type === "Interception" ? 2 : 1,
    steps: [
      {
        ...take.step,
        resetMovers: true,
        overlay: null,
        movers: { ...take.step.movers, ...only(interceptor, cut) },
        highlight: cast(passer),
        possession: side,
      },
      { ball: { at: cut, ease: "linear" }, highlight: cast(passer, interceptor) },
      { overlay: { kind: "cut", from, at: cut }, possession: opposite(side) },
    ],
  };
}

/** A defender wins the ball where it is, team-mates closing it down with him. */
function stageWinBack(cue: Cue): Staging {
  return { steps: [contestBall(cue).step] };
}

/** A dribble's length, and how many touches the dribbler takes over it. */
const DRIBBLE_METRES = 10;
const DRIBBLE_TOUCHES = 3;
/** How far ahead of the dribbler each touch pushes the ball. */
const TOUCH_AHEAD = 1.4;
/** How far the run bends away from the defender at its widest. */
const DRIBBLE_BEND = 2.5;
/** How far goal-side the defender holds off the dribbler: a few metres, never on top of him. */
const JOCKEY_GAP = 6;

/** The longest a single touch carries the ball. */
const TOUCH_METRES = 3.5;

/**
 * A run with the ball from `from` to `to` (both in `side`'s view), as touches
 * of at most a few metres: each pushes the ball a stride ahead and the runner
 * runs onto it, so ball and runner always travel together.
 */
function carryTouches(
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
    };
  });
}

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
  const { depth, lane } = fromPitch(side, start);
  // Wide men run down the line; the rest straight at goal.
  const endLane = clamp(lane + (lane < 24 ? -4 : lane > 44 ? 4 : 0), 3, 65);
  // A defender or midfielder steps up to him — not a forward caught upfield.
  const focus: ShapeFocus = { x: start.x, y: start.y, possession: side };
  const defender = nearestOpponent(stage, side, start, focus, ["Defender", "Midfielder"]);
  const defenderLane = defender ? fromPitch(side, where(cue, defender)).lane : lane + 1;
  // Bend away from the defender, but never towards a touchline he is already near.
  const awayFromDefender = defenderLane >= lane ? -1 : 1;
  const bend = lane < 8 ? 1 : lane > 60 ? -1 : awayFromDefender;

  const touches: RadarStep[] = [];
  for (let touch = 1; touch <= DRIBBLE_TOUCHES; touch++) {
    const progress = touch / DRIBBLE_TOUCHES;
    const runDepth = depth + DRIBBLE_METRES * progress;
    const runLane =
      lane + (endLane - lane) * progress + bend * DRIBBLE_BEND * Math.sin(Math.PI * progress);
    const feet = onPitch(toPitch(side, runDepth, runLane));
    const isLastTouch = touch === DRIBBLE_TOUCHES;
    // Goal-side and giving ground, then beaten: on the last touch the dribbler is past him.
    // Beaten, he turns aside where he stood rather than dropping back through the dribbler.
    const jockey = isLastTouch
      ? toPitch(side, runDepth - 1, runLane - bend * 6.5)
      : toPitch(side, runDepth + JOCKEY_GAP - touch * 0.6, runLane - bend * 1.2);
    touches.push({
      pace: "carry",
      ball: { at: onPitch(toPitch(side, runDepth + TOUCH_AHEAD, runLane)), ease: "push" },
      movers: { ...only(runner, feet), ...only(defender, onPitch(jockey)) },
      highlight: cast(runner, defender),
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
  const { depth, lane } = fromPitch(side, take.at);
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
  const flank = fromPitch(side, take.at).lane < CENTRE_LANE ? 6 : 62;
  const wingSpot = toPitch(side, 94, flank);
  const carry = paceSeconds("carry", distance(take.at, wingSpot));
  // The man it is aimed at sets off as the winger heads for the line, and the
  // ball is put where he will be.
  const want = toPitch(side, 95, CENTRE_LANE + (flank < CENTRE_LANE ? 3 : -3));
  const landing = target
    ? meetingPoint(
        where(cue, target),
        want,
        (point) => distance(wingSpot, point) / PACE_SPEED.air,
        take.seconds + carry,
      )
    : want;
  const marker = nearestOpponent(stage, side, landing, boxFocus);
  return {
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
      },
      { ball: { at: lerp(wingSpot, landing, 0.5), lift: 7, ease: "out" } },
      { ball: { at: landing, lift: 0, ease: "in" } },
    ],
  };
}

function stageClearance(cue: Cue): Staging {
  const { event } = cue;
  const side = event.side;
  const won = contestBall(cue);
  const at = won.at;
  const out = onPitch(toPitch(side, 50 + jitter(`${event.minute}c`) * 8, fromPitch(side, at).lane));
  return {
    steps: [
      { ...won.step, possession: undefined },
      { ball: { at: lerp(at, out, 0.5), lift: 5, ease: "out" } },
      { ball: { at: out, lift: 0, ease: "in" }, possession: side },
    ],
  };
}

/** Where a shot is struck from: the shooter's feet if he has the ball, else laid into his path. */
function shootingSpot(cue: Cue, shooter: string | null): PitchPoint {
  const { scene } = cue;
  const side = cue.event.side;
  const from = where(cue, shooter);
  if (shooter && distance(from, scene.ball) <= TOUCH_AHEAD + 0.6) return from;
  const lane = fromPitch(side, from).lane;
  const want = toPitch(side, 88, CENTRE_LANE + (lane - CENTRE_LANE) * 0.45);
  if (!shooter) return want;
  return meetingPoint(from, want, (point) => distance(scene.ball, point) / PACE_SPEED.pass, 0);
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
        { ball: { at: block, ease: "linear" }, movers: only(blocker, block), pace: "shot" },
        { ball: { at: rebound }, highlight: cast(shooter, blocker) },
      ];
    }
    default: {
      // Off target, or a missed penalty: past a post.
      const wide = toPitch(side, 107, CENTRE_LANE + (spin >= 0 ? 1 : -1) * (GOAL_HALF_WIDTH + 3));
      return [{ ball: { at: wide, ease: "linear" }, possession: opposite(side), pace: "shot" }];
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
    { ball: { at: net, ease: "linear" }, goal: side, highlight: cast(scorer), pace: "shot" },
    { movers: huddle },
  ];
}

function stageShot(cue: Cue): Staging {
  const shooter = cue.event.player_id;
  const spot = shootingSpot(cue, shooter);
  const isGoal = cue.event.event_type === "Goal";
  return {
    important: isGoal,
    steps: [
      {
        ball: { at: spot, ease: "linear" },
        movers: only(shooter, spot),
        highlight: cast(shooter),
        possession: cue.event.side,
        overlay: null,
      },
      ...stageShotFinish(cue, spot, shooter),
    ],
  };
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
      },
    ],
  };
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
      return stageRestart(cue, toPitch(side, 104.6, flank), attackingBoxX(side));
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
    case "FreeKick":
      return {
        steps: [
          {
            ball: ballAsStaged(cue),
            overlay: { kind: "whistle", at: cue.scene.ball },
            possession: side,
          },
        ],
      };
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

/** Where the engine left the ball at the end of the batch. */
export interface RadarSettle {
  ballZone: string;
  possession: Side;
}

/**
 * Stage a batch of events — the events of one tick of the live match — from
 * `start`. Pass `settle` to end where the engine left the ball: possession can
 * change hands between events without an event of its own.
 */
export function choreographBatch(
  events: MatchEvent[],
  stage: RadarStage,
  start: RadarScene,
  settle?: RadarSettle,
): { beats: RadarBeat[]; end: RadarScene } {
  const beats: RadarBeat[] = [];
  let scene = start;
  let index = 0;
  while (index < events.length) {
    const event = events[index];
    const staging = stageEvent({ event, next: events[index + 1], scene, stage });
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
      });
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

/** How far inside a zone's edge a settled ball is put, so it reads as in that zone. */
const SETTLE_INSET = 2;

function settleStepsFor(
  stage: RadarStage,
  scene: RadarScene,
  settle: RadarSettle,
): RadarStep[] | null {
  const ballInGoal = scene.ball.x < 0 || scene.ball.x > PITCH_LENGTH;
  const [from, to] = zoneSpan(settle.ballZone);
  const x = clamp(scene.ball.x, from + SETTLE_INSET, to - SETTLE_INSET);
  const ballMoves = ballInGoal || Math.abs(x - scene.ball.x) > SETTLE_INSET;
  if (!ballMoves && scene.possession === settle.possession) return null;
  if (!ballMoves) return [{ possession: settle.possession, pace: "place" }];
  // After a goal the engine restarts from the centre spot. Otherwise the ball is
  // only nudged back into the zone the engine left it in — a zone is a wide band.
  const at = ballInGoal ? { x: HALFWAY, y: CENTRE_LANE } : { x, y: clamp(scene.ball.y, 10, 58) };
  // A player still on the ball takes it there himself rather than the ball rolling off alone.
  const carrier =
    !ballInGoal && settle.possession === scene.possession
      ? ballCarrier(stage, scene, settle.possession)
      : null;
  if (carrier) {
    const target = fromPitch(settle.possession, at);
    return carryTouches(
      settle.possession,
      carrier,
      fromPitch(settle.possession, scene.movers[carrier]),
      { depth: target.depth - TOUCH_AHEAD, lane: target.lane },
    );
  }
  return [
    {
      ball: { at, lift: 0 },
      resetMovers: true,
      possession: settle.possession,
      pace: ballInGoal ? "place" : "pass",
    },
  ];
}
