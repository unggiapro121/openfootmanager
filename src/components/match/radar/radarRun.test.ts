import { describe, expect, it } from "vitest";

import type { MatchEvent } from "../types";
import { choreographBatch, choreographHighlights } from "./radarChoreography";
import type { RadarSettle } from "./radarSettle";
import { distance, toPitch } from "./radarGeometry";
import { enqueueBeats, restingPlayback } from "./radarPlayback";
import { type RadarRun, advanceRun, startRun } from "./radarRun";
import { type RadarScene, focusOf, initialRadarScene } from "./radarScene";
import { SIM_LIMITS } from "./radarSim";
import { buildRadarStage } from "./radarStage";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";
import { queueBeat } from "./radarTiming";

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

  // Given a busy minute, then no one ever runs faster than a footballer can (T5).
  it("never moves a player faster than a sprint", () => {
    let fastest = 0;
    for (let index = 1; index < frames.length; index++) {
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
  // about half a second: the ball gone for a moment and back in the zone the
  // engine left it in, a man of the side it gave it to going for it.
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
    const { ball } = frames[over];
    expect(ball.kind === "loose" && ball.chaser?.startsWith("a_")).toBe(true);
    expect(ball.at.x).toBeLessThan(38);
    for (let index = 1; index <= over; index++) {
      const isSeen = frames[index].ball.opacity > 0 && frames[index - 1].ball.opacity > 0;
      if (isSeen) expect(ballSpeed(frames, index)).toBeLessThanOrEqual(35);
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
