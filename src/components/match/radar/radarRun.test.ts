import { describe, expect, it } from "vitest";

import type { MatchEvent } from "../types";
import { choreographBatch, choreographHighlights } from "./radarChoreography";
import type { RadarSettle } from "./radarSettle";
import { CENTRE_LANE, distance, fromPitch, toPitch, zoneSpan } from "./radarGeometry";
import { enqueueBeats, restingPlayback } from "./radarPlayback";
import { type RadarRun, advanceRun, startRun } from "./radarRun";
import { type RadarScene, type RadarStep, focusOf, initialRadarScene } from "./radarScene";
import { SIM_LIMITS } from "./radarSim";
import { buildRadarStage } from "./radarStage";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";
import { READ_MS } from "./radarCommentaryFeed";
import { queueBeat, timeSteps } from "./radarTiming";
import { RADAR_PACING } from "./useRadarDirector";

const snapshot = radarSnapshot();
const stage = buildRadarStage(snapshot);
const start = initialRadarScene(snapshot);
const FRAME_MS = 1000 / 60;
const FRAME_S = FRAME_MS / 1000;

interface Options {
  restMs?: number;
  idle?: boolean;
  from?: RadarScene;
  settle?: RadarSettle;
  /** Stage only the dangerous play, as the 2D mode does. */
  highlightsOnly?: boolean;
}

/** Plays `events` out at 60 frames a second until nothing is left to play, then `restMs` more. */
function simulate(
  events: MatchEvent[],
  { restMs = 0, idle = true, from = start, settle, highlightsOnly = false }: Options = {},
): RadarRun[] {
  const stageMinute = highlightsOnly ? choreographHighlights : choreographBatch;
  const { beats } = stageMinute(events, stage, from, settle);
  const playback = enqueueBeats(
    restingPlayback(from),
    beats.map((beat) => queueBeat(beat, 1)),
    Number.POSITIVE_INFINITY,
  );
  let run = startRun(stage, playback);
  const frames: RadarRun[] = [run];
  let restingFor = 0;
  for (let frame = 0; frame < 60 * 90; frame++) {
    run = advanceRun(run, stage, FRAME_MS, { idle });
    frames.push(run);
    const isResting =
      !run.playback.step && run.playback.queue.length === 0 && run.ball.kind !== "dead";
    if (isResting && restingFor >= restMs) break;
    restingFor = isResting ? restingFor + FRAME_MS : 0;
  }
  return frames;
}

function speedOf(frames: RadarRun[], index: number, playerId: string): number {
  const now = frames[index].sim.players[playerId]?.at;
  const before = frames[index - 1].sim.players[playerId]?.at;
  return now && before ? distance(now, before) / FRAME_S : 0;
}

function ballSpeed(frames: RadarRun[], index: number): number {
  return distance(frames[index].ball.at, frames[index - 1].ball.at) / FRAME_S;
}

const holderOf = (run: RadarRun) => (run.ball.kind === "held" ? run.ball.holder : null);

/** Whether `point` is in the box the home side attacks. */
const isInAwayBox = (point: { x: number; y: number }) =>
  point.x >= zoneSpan("AwayBox")[0] && Math.abs(point.y - CENTRE_LANE) <= 20.16;

/**
 * The frames in which a man keeps the ball while the script has no mark for
 * him, and the furthest he moves in any one of them.
 */
function unscriptedHolding(frames: RadarRun[]): { frames: number; furthest: number } {
  let held = 0;
  let furthest = 0;
  for (let index = 1; index < frames.length; index++) {
    const now = frames[index];
    const holder = holderOf(now);
    if (!holder || holder !== holderOf(frames[index - 1]) || holder in now.marks) continue;
    held += 1;
    const from = frames[index - 1].sim.players[holder].at;
    furthest = Math.max(furthest, distance(from, now.sim.players[holder].at));
  }
  return { frames: held, furthest };
}

const playerIds = Object.keys(startRun(stage, restingPlayback(start)).sim.players);
const homeIds = playerIds.filter((id) => id.startsWith("h_"));
const awayIds = playerIds.filter((id) => id.startsWith("a_"));

const busyMinute = [
  radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
  radarEvent("Dribble", "Home", "AwayDefense", "h_st2"),
  radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1"),
  radarEvent("ShotOffTarget", "Home", "AwayBox", "h_st2"),
  radarEvent("GoalKick", "Away", "AwayBox"),
  radarEvent("PassCompleted", "Away", "AwayDefense", "a_cb1"),
  radarEvent("Tackle", "Home", "Midfield", "h_cm2"),
  radarEvent("PenaltyAwarded", "Home", "AwayBox"),
  radarEvent("PenaltyMiss", "Home", "AwayBox", "h_st2"),
  radarEvent("GoalKick", "Away", "AwayBox"),
  radarEvent("PassCompleted", "Away", "AwayDefense", "a_cb2"),
  radarEvent("Interception", "Home", "Midfield", "h_cm2"),
  radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk"),
  radarEvent("Corner", "Home", "AwayBox"),
  radarEvent("Clearance", "Away", "AwayBox", "a_cb2"),
  radarEvent("PassCompleted", "Away", "AwayDefense", "a_cm2"),
  radarEvent("Tackle", "Home", "Midfield", "h_cm1"),
  radarEvent("ShotBlocked", "Home", "AwayBox", "h_st1"),
];
/** After the home side's last attack, the engine hands the ball to the away side in midfield, with no event. */
const turnover: RadarSettle = { ballZone: "Midfield", possession: "Away" };

describe("radar run — a busy minute", () => {
  const frames = simulate(busyMinute, { restMs: 3000, settle: turnover });

  // Given a busy minute, then no one ever runs faster than a footballer can
  // (T5). The one frame a change of scene puts everyone in place, out of
  // sight, is not running (after GĐ5).
  it("never moves a player faster than a sprint", () => {
    let fastest = 0;
    for (let index = 1; index < frames.length; index++) {
      const isPutInPlace = !!frames[index].sceneCut?.placed && !frames[index - 1].sceneCut?.placed;
      if (isPutInPlace) continue;
      for (const id of playerIds) fastest = Math.max(fastest, speedOf(frames, index, id));
    }
    expect(fastest).toBeLessThanOrEqual(SIM_LIMITS.sprint + 0.01);
  });

  // Given the ball changing hands, then whoever strikes it or takes it is on
  // it at that very frame — never a ball leaving or reaching an empty spot (T3).
  it("has a man on the ball whenever it changes hands", () => {
    let handovers = 0;
    for (let index = 1; index < frames.length; index++) {
      const before = frames[index - 1];
      const now = frames[index];
      const giver = holderOf(before);
      const isStruck =
        now.ball.kind === "flight" &&
        (before.ball.kind !== "flight" || before.ball.startedAt !== now.ball.startedAt);
      if (now.ball.kind === "flight" && isStruck) {
        handovers += 1;
        const kicker = now.ball.kicker;
        expect(kicker, "a kick with no one to strike it").not.toBeNull();
        const at = before.sim.players[kicker ?? ""]?.at ?? { x: Number.NaN, y: Number.NaN };
        expect(distance(at, now.ball.at), `struck by ${kicker}`).toBeLessThanOrEqual(1.5 + 1e-6);
      }
      const taker = holderOf(now);
      if (taker && taker !== giver) {
        handovers += 1;
        const at = now.sim.players[taker].at;
        expect(distance(at, now.ball.at), `taken by ${taker}`).toBeLessThanOrEqual(1.5 + 1e-6);
      }
    }
    expect(handovers).toBeGreaterThan(10);
  });

  // Given a step that strikes the ball, then the script waits for the ball to
  // get there before it moves on: play never runs ahead of the ball.
  it("holds the script until the ball has got there", () => {
    const actionOf = (run: RadarRun) =>
      run.playback.step ? run.playback.beat?.beat.steps[run.playback.index]?.action : undefined;
    let movedOnMidFlight = 0;
    for (let index = 1; index < frames.length; index++) {
      const before = frames[index - 1];
      const now = frames[index];
      const isNextStep =
        now.playback.beat !== before.playback.beat || now.playback.index !== before.playback.index;
      const isSameFlight =
        before.ball.kind === "flight" &&
        now.ball.kind === "flight" &&
        now.ball.startedAt === before.ball.startedAt;
      if (isNextStep && actionOf(before)?.kind === "kick" && isSameFlight) movedOnMidFlight += 1;
    }
    expect(movedOnMidFlight).toBe(0);
  });

  // Given passes played to a man, then nearly all arrive at his feet: the ball is
  // aimed where he gets to, not at a spot he then has to chase it from.
  it("plays passes to the receiver's feet", () => {
    let aimed = 0;
    let atFeet = 0;
    for (let index = 1; index < frames.length; index++) {
      const before = frames[index - 1].ball;
      const now = frames[index].ball;
      if (before.kind !== "flight" || now.kind === "flight" || !before.receiver) continue;
      aimed += 1;
      if (now.kind === "held" && now.holder === before.receiver) atFeet += 1;
    }
    expect(aimed).toBeGreaterThan(5);
    expect(atFeet / aimed).toBeGreaterThanOrEqual(0.75);
  });

  // Given the ball's path, including restarts, then it never travels faster
  // than a hard shot; when it goes out of play it vanishes and comes back,
  // rather than sliding across the pitch (T12).
  it("never moves the ball faster than a hard shot while it is seen", () => {
    for (let index = 1; index < frames.length; index++) {
      const isSeen = frames[index].ball.opacity > 0 && frames[index - 1].ball.opacity > 0;
      if (isSeen) expect(ballSpeed(frames, index)).toBeLessThanOrEqual(35);
    }
  });

  // Given a man carrying the ball, then it sits at his feet, on the edge of his
  // dot — never under his number, never left behind (T13).
  it("keeps a carried ball at the carrier's feet", () => {
    let heldFor = 0;
    for (let index = 1; index < frames.length; index++) {
      const run = frames[index];
      const holder = holderOf(run);
      heldFor = holder && holder === holderOf(frames[index - 1]) ? heldFor + FRAME_S : 0;
      if (!holder || heldFor < 0.5) continue;
      const gap = distance(run.sim.players[holder].at, run.ball.at);
      expect(gap).toBeGreaterThanOrEqual(1.2 - 1e-6);
      expect(gap).toBeLessThanOrEqual(2 + 1e-6);
    }
  });

  // Given an open-play shot, then it leaves the shooter's foot inside the box,
  // as the engine has it; never from 20-odd metres out (T15).
  it("strikes every open-play shot from inside the box", () => {
    let shots = 0;
    for (let index = 1; index < frames.length; index++) {
      const now = frames[index];
      const before = frames[index - 1];
      const isStruck =
        now.ball.kind === "flight" &&
        (before.ball.kind !== "flight" || before.ball.startedAt !== now.ball.startedAt);
      const acting = now.acting;
      const action = acting?.beat.beat.steps[acting.index]?.action;
      const isPenalty = acting?.beat.beat.eventType.startsWith("Penalty");
      if (!isStruck || action?.kind !== "kick" || action.pace !== "shot" || isPenalty) continue;
      shots += 1;
      expect(isInAwayBox(now.ball.at), JSON.stringify(now.ball.at)).toBe(true);
    }
    expect(shots).toBeGreaterThanOrEqual(3);
  });

  // Given a loose ball, then it is never left rolling about for a second with
  // no one going after it (T13).
  it("never leaves a rolling ball with no one after it", () => {
    let ownerless = 0;
    let longest = 0;
    for (let index = 1; index < frames.length; index++) {
      const { ball } = frames[index];
      const isOwnerless = ball.kind === "loose" && !ball.chaser && ballSpeed(frames, index) > 0.5;
      ownerless = isOwnerless ? ownerless + FRAME_S : 0;
      longest = Math.max(longest, ownerless);
    }
    expect(longest).toBeLessThan(1);
  });

  // Given play running, including a lull, then there is never a whole second
  // in which all 22 stand still (T7).
  it("never freezes the whole pitch for a second", () => {
    let still = 0;
    let longest = 0;
    for (let index = 1; index < frames.length; index++) {
      const allStill = playerIds.every((id) => speedOf(frames, index, id) < 0.2);
      still = allStill ? still + FRAME_MS : 0;
      longest = Math.max(longest, still);
    }
    expect(longest).toBeLessThan(1000);
  });

  // Given the ball on the move, then most of those not on it move too (T6).
  it("moves most of the team while the ball moves", () => {
    const counts: number[] = [];
    for (let index = 40; index < frames.length; index++) {
      if (ballSpeed(frames, index) < 3 || frames[index].ball.opacity < 1) continue;
      const holder = holderOf(frames[index]);
      counts.push(
        playerIds.filter((id) => id !== holder && speedOf(frames, index, id) > 0.3).length,
      );
    }
    counts.sort((a, b) => a - b);
    expect(counts[Math.floor(counts.length / 2)]).toBeGreaterThanOrEqual(10);
  });

  // Given the minute ends with the engine handing the ball over unannounced,
  // then the side on it gives it away and one of the other side gets to it.
  it("acts out an unannounced turnover", () => {
    const last = frames[frames.length - 1];
    expect(holderOf(last)?.startsWith("a_")).toBe(true);
    const givenAway = frames.some(
      (run) =>
        run.playback.beat?.beat.eventType === "Settle" &&
        run.ball.kind === "flight" &&
        run.ball.kicker?.startsWith("h_") &&
        run.ball.receiver?.startsWith("a_"),
    );
    expect(givenAway).toBe(true);
  });
});

describe("radar run — an unannounced turnover where the ball lies", () => {
  // Given the engine handing the ball over where it already is, then the nearest
  // of the other side takes it off the man on it.
  it("has the nearest of the other side take it", () => {
    const frames = simulate(
      [
        radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
        radarEvent("Dribble", "Home", "Midfield", "h_cm2"),
      ],
      { settle: { ballZone: "Midfield", possession: "Away" }, restMs: 500 },
    );
    expect(holderOf(frames[frames.length - 1])?.startsWith("a_")).toBe(true);
  });
});

describe("radar run — the 2D mode's quick changes of scene", () => {
  // Given a minute with nothing dangerous in it, then the radar is through it in
  // about half a second and acts nothing out: the ball stays where it lies,
  // however far the engine moved it (after GĐ5).
  it("passes over a quiet minute in a moment", () => {
    const frames = simulate(
      [
        radarEvent("PassCompleted", "Away", "AwayDefense", "a_cb1"),
        radarEvent("PassCompleted", "Away", "Midfield", "a_cm1"),
      ],
      { highlightsOnly: true, settle: { ballZone: "HomeDefense", possession: "Away" } },
    );
    const over = frames.findIndex(
      (run, index) => index > 0 && !run.playback.step && run.playback.queue.length === 0,
    );
    expect(over * FRAME_S).toBeLessThanOrEqual(0.55);
    for (let index = 1; index <= over; index++) {
      expect(distance(frames[index].ball.at, start.ball)).toBeLessThan(0.5);
    }
  });

  // Given an attack that starts far from where the ball lies, then the radar
  // opens it with the same quick change: the ball back at the feet of the man
  // who starts the move, not a long run or pass to get it to him.
  it("opens a far-off move at the feet of the man who starts it", () => {
    const frames = simulate(
      [
        radarEvent("PassCompleted", "Away", "AwayDefense", "a_cb1"),
        radarEvent("Dribble", "Away", "HomeDefense", "a_st1"),
        radarEvent("ShotOffTarget", "Away", "HomeBox", "a_st1"),
      ],
      { highlightsOnly: true },
    );
    const firstHeld = frames.find((run) => holderOf(run));
    expect(holderOf(firstHeld ?? frames[0])).toBe("a_cb1");
    const takenAt = frames.indexOf(firstHeld ?? frames[0]);
    expect(takenAt * FRAME_S).toBeLessThanOrEqual(0.55);
  });
});

describe("radar run — a man left on the ball", () => {
  // Given the ball put back at a man's feet in the box (a change of scene to
  // the start of a move) and nothing scripted after it, then he shields it
  // where he stands while the script has no mark for him: his place in the
  // shape never drags him, ball and all, about the box or back towards his
  // own goal (T14).
  it("leaves him where he stands when the script does not move him", () => {
    const spot = toPitch("Home", 95, CENTRE_LANE);
    const steps: RadarStep[] = [
      {
        ball: { at: spot, lift: 0 },
        resetMovers: true,
        possession: "Home",
        pace: "place",
        action: { kind: "dead", spot, quick: true, holder: "h_st2" },
      },
    ];
    const timed = timeSteps(stage, start, steps);
    const beat = {
      key: "put-back",
      eventType: "Settle",
      steps,
      ...timed,
      important: false,
      prefer: false,
    };
    let run = startRun(
      stage,
      enqueueBeats(restingPlayback(start), [queueBeat(beat, 1)], Number.POSITIVE_INFINITY),
    );
    const frames: RadarRun[] = [run];
    for (let frame = 0; frame < 60 * 8; frame++) {
      run = advanceRun(run, stage, FRAME_MS);
      frames.push(run);
    }
    const { frames: held, furthest } = unscriptedHolding(frames);
    expect(held).toBeGreaterThan(60);
    expect(furthest).toBeLessThan(1e-6);
  });
});

describe("radar run — a corner (after GĐ5)", () => {
  /** A blocked shot, the corner it wins, and the corner crossed in for a header saved. */
  const cornerMove = [
    radarEvent("ShotBlocked", "Home", "AwayBox", "h_st1"),
    radarEvent("Corner", "Home", "AwayBox", "h_rm"),
    radarEvent("Cross", "Home", "AwayBox", "h_rm", "h_st2"),
    radarEvent("ShotSaved", "Home", "AwayBox", "h_st2", "a_gk"),
  ];
  const flags = [toPitch("Home", 104.6, 0.8), toPitch("Home", 104.6, 67.2)];
  const fromFlag = (at: { x: number; y: number }) =>
    Math.min(...flags.map((flag) => distance(at, flag)));

  // Given a corner, then the man who takes it goes to the flag, the ball comes
  // back at his feet there, and the cross leaves from his feet: the ball never
  // flies off the flag on its own.
  it("crosses the corner from the taker's feet at the flag", () => {
    const frames = simulate(cornerMove, { highlightsOnly: true });
    const cornerShown = frames.findIndex(
      (run) => run.ball.kind === "held" && run.ball.holder === "h_rm",
    );
    expect(cornerShown).toBeGreaterThan(0);
    expect(fromFlag(frames[cornerShown].ball.at)).toBeLessThan(3);
    const struck = frames.findIndex(
      (run, index) => index > cornerShown && run.ball.kind === "flight",
    );
    expect(struck).toBeGreaterThan(cornerShown);
    const before = frames[struck - 1];
    expect(before.ball.kind === "held" && before.ball.holder).toBe("h_rm");
    expect(fromFlag(before.sim.players.h_rm.at)).toBeLessThan(3);
  });

  // Given a corner taken by a man far from the flag, then the corner is a
  // change of scene: the players are put in place for it rather than the
  // taker running the length of the pitch, and the cross goes in within a
  // couple of seconds of the corner being given.
  it("cuts to a corner taken by a man far from the flag", () => {
    const frames = simulate(cornerMove, { highlightsOnly: true });
    const given = frames.findIndex((run) => run.acting?.beat.beat.eventType === "Corner");
    expect(given).toBeGreaterThan(0);
    expect(frames.slice(given).some((run) => run.sceneCut !== null)).toBe(true);
    const struck = frames.findIndex(
      (run, index) =>
        index > given && run.acting?.beat.beat.eventType === "Cross" && run.ball.kind === "flight",
    );
    expect((struck - given) * FRAME_S).toBeLessThan(3);
  });
});

describe("radar run — a corner cleared at once (after GĐ5)", () => {
  const flags = [toPitch("Home", 104.6, 0.8), toPitch("Home", 104.6, 67.2)];
  const fromFlag = (at: { x: number; y: number }) =>
    Math.min(...flags.map((flag) => distance(at, flag)));

  // Given a corner the engine clears with no cross, then the taker still
  // kicks it into the box from the flag — he never carries it in himself —
  // and the defender clears it from there.
  it("kicks the corner in from the flag before it is cleared", () => {
    const frames = simulate(
      [
        radarEvent("ShotBlocked", "Home", "AwayBox", "h_st1"),
        radarEvent("Corner", "Home", "AwayBox", "h_rm"),
        radarEvent("Clearance", "Away", "AwayBox", "a_cb1"),
      ],
      { highlightsOnly: true },
    );
    const holding = frames.filter((run) => run.ball.kind === "held" && run.ball.holder === "h_rm");
    expect(holding.length).toBeGreaterThan(0);
    for (const run of holding) expect(fromFlag(run.sim.players.h_rm.at)).toBeLessThan(3);
    const last = frames.lastIndexOf(holding[holding.length - 1]);
    expect(frames[last + 1].ball.kind).toBe("flight");
    const cleared = frames.findIndex(
      (run, index) => index > last && run.acting?.beat.beat.eventType === "Clearance" && run.struck,
    );
    expect(cleared).toBeGreaterThan(last);
  });
});

describe("radar run — a free kick (after GĐ5)", () => {
  /** Plays `events` and returns the frames from the free kick on, and where its taker has the ball. */
  function fromTheKick(events: MatchEvent[], taker: string) {
    const frames = simulate(events, { highlightsOnly: true });
    const given = frames.findIndex((run) => run.acting?.beat.beat.eventType === "FreeKick");
    const ready = frames.findIndex(
      (run, index) => index > given && run.ball.kind === "held" && run.ball.holder === taker,
    );
    const struck = frames.findIndex((run, index) => index > ready && run.ball.kind === "flight");
    return { frames, given, ready, struck };
  }

  // Given a direct free kick, then the ball comes back at the taker's feet on
  // its spot and he strikes it from there: it never rolls or is carried to him.
  it("strikes a direct free kick from its spot", () => {
    const shot = {
      ...radarEvent("ShotOffTarget", "Home", "AwayDefense", "h_cm1"),
      shot_kind: "DirectFreeKick" as const,
    };
    const { frames, given, ready, struck } = fromTheKick(
      [
        radarEvent("Foul", "Away", "AwayDefense", "a_cb1", "h_st1"),
        radarEvent("FreeKick", "Home", "AwayDefense"),
        shot,
      ],
      "h_cm1",
    );
    expect(given).toBeGreaterThan(0);
    expect(ready).toBeGreaterThan(given);
    expect(struck).toBeGreaterThan(ready);
    const spot = frames[ready].ball.at;
    for (let index = ready; index < struck; index++) {
      expect(distance(frames[index].ball.at, spot), `frame ${index}`).toBeLessThan(1);
    }
  });

  // Given a free kick crossed in, then the taker has the ball where the foul
  // was and crosses it from there, with no run down the wing first (the ball
  // only swings about his feet as he turns).
  it("crosses a free kick from where it was given", () => {
    const { frames, ready, struck } = fromTheKick(
      [
        radarEvent("Foul", "Away", "AwayDefense", "a_lb", "h_rm"),
        radarEvent("FreeKick", "Home", "AwayDefense"),
        radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1"),
        radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk"),
      ],
      "h_rm",
    );
    expect(ready).toBeGreaterThan(0);
    expect(struck).toBeGreaterThan(ready);
    const spot = frames[ready].ball.at;
    for (let index = ready; index < struck; index++) {
      expect(distance(frames[index].ball.at, spot), `frame ${index}`).toBeLessThan(2);
    }
  });
});

describe("radar run — a long shot (after GĐ5)", () => {
  /** How far from the goal the shot of `events` leaves the shooter's foot, in metres. */
  function strikeDistance(events: MatchEvent[]): number {
    const frames = simulate(events, { highlightsOnly: true });
    const struck = frames.findIndex(
      (run, index) =>
        index > 0 &&
        run.acting?.beat.beat.eventType === "ShotOffTarget" &&
        run.ball.kind === "flight" &&
        frames[index - 1].ball.kind !== "flight",
    );
    expect(struck).toBeGreaterThan(0);
    return 105 - fromPitch("Home", frames[struck - 1].ball.at).depth;
  }
  const longShot = (player: string) => ({
    ...radarEvent("ShotOffTarget", "Home", "AwayDefense", player),
    shot_kind: "LongRange" as const,
  });

  // Given a long shot by a man the ball is passed to in midfield, then he
  // carries it to shooting range and strikes it from 20 to 26 metres out,
  // never from where he got it.
  it("strikes a long shot from range after a pass in midfield", () => {
    const distanceOut = strikeDistance([
      radarEvent("PassCompleted", "Home", "Midfield", "h_cb1"),
      longShot("h_cm1"),
    ]);
    expect(distanceOut).toBeGreaterThanOrEqual(18);
    expect(distanceOut).toBeLessThanOrEqual(28);
  });

  // Given a move that is a long shot alone, by a midfielder standing deep,
  // then it opens with him already at shooting range, not in his own half.
  it("opens a lone long shot at shooting range", () => {
    const distanceOut = strikeDistance([
      radarEvent("Clearance", "Away", "HomeBox", "a_cb1"),
      longShot("h_cm2"),
    ]);
    expect(distanceOut).toBeGreaterThanOrEqual(18);
    expect(distanceOut).toBeLessThanOrEqual(28);
  });
});

describe("radar run — a penalty (after GĐ5)", () => {
  // Given a penalty played at the radar's own pace, then the taker waits on
  // the spot long enough for the award to be told before he strikes it: the
  // commentary never trails the kick.
  it("strikes a penalty only once the award has been told", () => {
    const events = [
      radarEvent("Dribble", "Home", "AwayDefense", "h_st1"),
      radarEvent("Foul", "Away", "AwayBox", "a_cb1", "h_st1"),
      radarEvent("PenaltyAwarded", "Home", "AwayBox"),
      { ...radarEvent("PenaltyGoal", "Home", "AwayBox", "h_st2"), shot_kind: "Penalty" as const },
    ];
    const { beats } = choreographHighlights(events, stage, start);
    let run = startRun(
      stage,
      enqueueBeats(
        restingPlayback(start),
        beats.map((beat) => queueBeat(beat, RADAR_PACING.timeScale)),
        Number.POSITIVE_INFINITY,
      ),
    );
    let awardedAt: number | null = null;
    let struckAt: number | null = null;
    for (let frame = 0; frame < 60 * 20 && struckAt === null; frame++) {
      const before = run;
      run = advanceRun(run, stage, FRAME_MS);
      const type = run.acting?.beat.beat.eventType;
      if (type === "PenaltyAwarded" && awardedAt === null) awardedAt = run.sim.time;
      if (type === "PenaltyGoal" && run.ball.kind === "flight" && before.ball.kind !== "flight") {
        struckAt = run.sim.time;
      }
    }
    expect(awardedAt).not.toBeNull();
    expect(struckAt).not.toBeNull();
    expect((struckAt ?? 0) - (awardedAt ?? 0)).toBeGreaterThanOrEqual(READ_MS / 1000);
  });

  const spot = toPitch("Home", 94, CENTRE_LANE);
  const inTheBox = (at: { x: number; y: number }) => {
    const { depth, lane } = fromPitch("Home", at);
    return depth > 88.5 && Math.abs(lane - CENTRE_LANE) < 20.16;
  };

  // Given a penalty given for a foul in the box, then when it is struck the
  // ball is on the spot, the keeper on his line, and nobody but the taker and
  // the keeper is in the box.
  for (const kick of ["PenaltyGoal", "PenaltyMiss"] as const) {
    it(`lines a penalty up by the laws before it is struck (${kick})`, () => {
      const frames = simulate(
        [
          radarEvent("Dribble", "Home", "AwayDefense", "h_st1"),
          radarEvent("Foul", "Away", "AwayBox", "a_cb1", "h_st1"),
          radarEvent("PenaltyAwarded", "Home", "AwayBox"),
          { ...radarEvent(kick, "Home", "AwayBox", "h_st2"), shot_kind: "Penalty" as const },
        ],
        { highlightsOnly: true },
      );
      const struck = frames.findIndex(
        (run, index) =>
          index > 0 &&
          run.acting?.beat.beat.eventType === kick &&
          run.ball.kind === "flight" &&
          frames[index - 1].ball.kind !== "flight",
      );
      expect(struck).toBeGreaterThan(0);
      const before = frames[struck - 1];
      expect(distance(before.ball.at, spot)).toBeLessThan(1);
      expect(fromPitch("Home", before.sim.players.a_gk.at).depth).toBeGreaterThan(103.5);
      const inside = Object.entries(before.sim.players)
        .filter(([id, player]) => id !== "h_st2" && id !== "a_gk" && inTheBox(player.at))
        .map(([id]) => id);
      expect(inside).toEqual([]);
    });
  }
});

describe("radar run — a pass forward to a man behind (after GĐ5)", () => {
  // Given a midfielder on the ball and the engine's next action a run by the
  // left back from deep, then the pass goes forward into space and the full
  // back runs onto it: every completed pass in the engine moves the ball up a
  // zone, so the radar never draws it played back to him.
  it("plays the ball forward for a full back to run onto, never back to him", () => {
    const passerAt = toPitch("Home", 62, 20);
    const from: RadarScene = {
      ...start,
      ball: passerAt,
      focusX: passerAt.x,
      movers: { h_cm1: passerAt },
    };
    const events = [
      radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
      radarEvent("Dribble", "Home", "AwayDefense", "h_lb"),
    ];
    const { beats } = choreographBatch(events, stage, from);
    const pass = beats.find((beat) => beat.eventType === "PassCompleted");
    const kick = pass?.steps.find((step) => step.action?.kind === "kick")?.action;
    expect(kick?.kind).toBe("kick");
    const to = kick?.kind === "kick" ? kick.to : passerAt;
    expect(fromPitch("Home", to).depth).toBeGreaterThanOrEqual(62 + 5);
    const frames = simulate(events, { from });
    const received = frames.find((run) => run.ball.kind === "held" && run.ball.holder === "h_lb");
    expect(received).toBeDefined();
    expect(fromPitch("Home", (received as RadarRun).ball.at).depth).toBeGreaterThan(62);
  });
});

describe("radar run — a dangerous free kick the engine answers silently (after GĐ5)", () => {
  // Given a free kick in the attacking third after which the engine simply
  // has the other side on the ball, then it is still taken: kicked into the
  // box and won by a defender, before the scene changes.
  it("takes a free kick the engine never says was taken", () => {
    const frames = simulate(
      [
        radarEvent("Foul", "Away", "AwayDefense", "a_cb1", "h_st1"),
        radarEvent("FreeKick", "Home", "AwayDefense"),
        radarEvent("PassCompleted", "Away", "AwayDefense", "a_cm1"),
      ],
      { highlightsOnly: true },
    );
    const kicked = frames.findIndex(
      (run, index) =>
        index > 0 && run.ball.kind === "flight" && !!holderOf(frames[index - 1])?.startsWith("h_"),
    );
    expect(kicked).toBeGreaterThan(0);
    const won = frames.findIndex(
      (run, index) => index > kicked && !!holderOf(run)?.startsWith("a_"),
    );
    expect(won).toBeGreaterThan(kicked);
  });
});

describe("radar run — a dangerous free kick cleared (after GĐ5)", () => {
  // Given a free kick in the attacking third that the engine has cleared at
  // once, then a man takes it, kicks it into the box from where it was given
  // — never carrying it there himself — and the defender clears it.
  it("kicks a free kick in before it is cleared", () => {
    const frames = simulate(
      [
        radarEvent("Foul", "Away", "AwayDefense", "a_cb1", "h_st1"),
        radarEvent("FreeKick", "Home", "AwayDefense"),
        radarEvent("YellowCard", "Away", "AwayDefense", "a_cb1"),
        radarEvent("FreeKick", "Home", "AwayDefense", "h_rm"),
        radarEvent("Clearance", "Away", "AwayBox", "a_cb2"),
      ],
      { highlightsOnly: true },
    );
    const holding = frames.filter((run) => run.ball.kind === "held" && run.ball.holder === "h_rm");
    expect(holding.length).toBeGreaterThan(0);
    const spot = holding[0].ball.at;
    for (const run of holding) expect(distance(run.ball.at, spot)).toBeLessThan(2);
    const last = frames.lastIndexOf(holding[holding.length - 1]);
    expect(frames[last + 1].ball.kind).toBe("flight");
    const cleared = frames.findIndex(
      (run, index) => index > last && run.acting?.beat.beat.eventType === "Clearance" && run.struck,
    );
    expect(cleared).toBeGreaterThan(last);
  });
});

describe("radar run — the ball out of play", () => {
  // Given a shot wide and a goal kick, then the ball vanishes, and is back on the
  // goal-kick spot within a second and a half, never sliding there.
  it("brings a dead ball back at its spot", () => {
    const frames = simulate(
      [
        radarEvent("ShotOffTarget", "Home", "AwayBox", "h_st1"),
        radarEvent("GoalKick", "Away", "AwayBox"),
      ],
      { restMs: 500 },
    );
    const gone = frames.findIndex((run) => run.ball.kind === "dead" && run.ball.opacity === 0);
    expect(gone).toBeGreaterThan(0);
    const back = frames.findIndex((run, index) => index > gone && run.ball.opacity === 1);
    expect((back - gone) * FRAME_S).toBeLessThanOrEqual(1.5);
    const spot = toPitch("Away", 5.5, 34 + 9);
    expect(distance(frames[back].ball.at, spot)).toBeLessThan(0.5);
  });
});

describe("radar run — playing it to the man who needs it", () => {
  // Given a header won by one striker and a shot by the other, then the first
  // lays the ball off to the second: it is played to him, not left for him.
  it("lays the ball off to a team-mate who has to shoot", () => {
    const frames = simulate([
      radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1"),
      radarEvent("ShotOffTarget", "Home", "AwayBox", "h_st2"),
    ]);
    const layOff = frames.some(
      (run, index) =>
        index > 0 &&
        run.ball.kind === "flight" &&
        holderOf(frames[index - 1]) === "h_st1" &&
        run.ball.receiver === "h_st2",
    );
    expect(layOff).toBe(true);
  });

  // Given a still ball far from the man who must take it, then it is rolled
  // towards him rather than left for him to sprint to.
  it("rolls a still ball towards a man too far from it", () => {
    const far: RadarScene = { ...start, ball: { x: 20, y: 8 }, focusX: 20 };
    const frames = simulate([radarEvent("PassCompleted", "Home", "Midfield", "h_cm2")], {
      from: far,
    });
    const taken = frames.findIndex((run) => holderOf(run) === "h_cm2");
    expect(taken).toBeGreaterThan(0);
    const rolledBefore = frames
      .slice(0, taken)
      .some((run) => run.ball.kind === "loose" && distance(run.ball.at, far.ball) > 3);
    expect(rolledBefore).toBe(true);
  });

  // Given a pass, then when it arrives the receiver takes it (T3).
  it("has the receiver take the pass", () => {
    const frames = simulate([
      radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
      radarEvent("Dribble", "Home", "AwayDefense", "h_st2"),
    ]);
    expect(frames.some((run) => holderOf(run) === "h_st2")).toBe(true);
  });
});

describe("radar run — acting out the play", () => {
  // Given a man the script sends 14 m in two seconds, then he gets there when
  // the script says — halfway at one second, on his mark at two.
  it("gets a man to his mark when the script says", () => {
    const from = stage.positionAt("h_st1", focusOf(start)) ?? start.ball;
    const mark = { x: from.x + 14, y: from.y };
    const playback = enqueueBeats(
      restingPlayback(start),
      [
        queueBeat(
          {
            key: "run",
            eventType: "Dribble",
            steps: [{ movers: { h_st1: mark } }],
            stepMs: [2000],
            runMs: [{ h_st1: 2000 }],
            important: false,
            prefer: false,
          },
          1,
        ),
      ],
      Number.POSITIVE_INFINITY,
    );
    let run = startRun(stage, playback);
    /** Where he is after `ms` more of play. */
    const at = (ms: number) => {
      for (let elapsed = 0; elapsed < ms - 1e-9; elapsed += FRAME_MS) {
        run = advanceRun(run, stage, FRAME_MS, { idle: false });
      }
      return run.sim.players.h_st1.at;
    };
    const oneSecondIn = at(1000);
    expect(distance(oneSecondIn, from)).toBeCloseTo(7, 0);
    const twoSecondsIn = at(1000);
    expect(distance(twoSecondsIn, mark)).toBeLessThan(0.1);
  });

  // Given everyone at rest and the ball set moving, then team-mates react one
  // after another — no two set off in the same frame (T11). Setting off is the
  // first movement at all, however slow.
  it("staggers when team-mates set off", () => {
    const frames = simulate([radarEvent("Dribble", "Home", "AwayDefense", "h_st1")], {
      idle: false,
    });
    for (const team of [homeIds, awayIds]) {
      const firstMoves = team
        .map((id) => frames.findIndex((_, index) => index > 0 && speedOf(frames, index, id) > 0.05))
        .filter((index) => index > 0);
      expect(firstMoves.length).toBeGreaterThanOrEqual(8);
      expect(new Set(firstMoves).size).toBe(firstMoves.length);
    }
  });
});
