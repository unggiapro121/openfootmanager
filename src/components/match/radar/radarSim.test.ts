import { describe, expect, it } from "vitest";

import type { MatchEvent } from "../types";
import { choreographBatch } from "./radarChoreography";
import { distance } from "./radarGeometry";
import { type Playback, advancePlayback, enqueueBeats, restingPlayback } from "./radarPlayback";
import { focusOf } from "./radarScene";
import { type RadarScene, initialRadarScene } from "./radarScene";
import { type RadarSim, SIM_LIMITS, restingSim, stepSim } from "./radarSim";
import { buildRadarStage } from "./radarStage";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";
import { queueBeat } from "./radarTiming";

const snapshot = radarSnapshot();
const stage = buildRadarStage(snapshot);
const start = initialRadarScene(snapshot);
const FRAME_MS = 1000 / 60;

interface Frame {
  sim: RadarSim;
  playback: Playback;
}

/** Plays `events` out at 60 frames a second, then `restMs` more with nothing queued. */
function simulate(
  events: MatchEvent[],
  {
    restMs = 0,
    idle = true,
    from = start,
  }: { restMs?: number; idle?: boolean; from?: RadarScene } = {},
): Frame[] {
  const { beats } = choreographBatch(events, stage, from);
  let playback = enqueueBeats(
    restingPlayback(from),
    beats.map((beat) => queueBeat(beat, 1)),
    Number.POSITIVE_INFINITY,
  );
  let sim = restingSim(stage, from);
  const totalMs = beats.reduce((sum, beat) => sum + beat.stepMs.reduce((a, b) => a + b, 0), 0);
  const frames: Frame[] = [{ sim, playback }];
  for (let elapsed = 0; elapsed < totalMs + restMs; elapsed += FRAME_MS) {
    playback = advancePlayback(playback, FRAME_MS);
    sim = stepSim(sim, stage, playback, FRAME_MS, { idle });
    frames.push({ sim, playback });
  }
  return frames;
}

/** Metres a second `playerId` moved at into frame `index`. */
function speedAt(frames: Frame[], index: number, playerId: string): number {
  const now = frames[index].sim.players[playerId]?.at;
  const before = frames[index - 1].sim.players[playerId]?.at;
  return now && before ? (distance(now, before) / FRAME_MS) * 1000 : 0;
}

const playerIds = Object.keys(restingSim(stage, start).players);
const homeIds = playerIds.filter((id) => id.startsWith("h_"));
const awayIds = playerIds.filter((id) => id.startsWith("a_"));

const busyMinute = [
  radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
  radarEvent("Dribble", "Home", "AwayDefense", "h_st2"),
  radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1"),
  radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk"),
  radarEvent("PassCompleted", "Away", "AwayDefense", "a_cb1"),
  radarEvent("Tackle", "Home", "Midfield", "h_cm2"),
];

describe("radar simulation", () => {
  const frames = simulate(busyMinute, { restMs: 6000 });

  // Given a busy minute, then no one ever runs faster than a footballer can —
  // not the man on the ball, not the block drifting into shape (T5).
  it("never moves a player faster than a sprint", () => {
    let fastest = 0;
    for (let index = 1; index < frames.length; index++) {
      for (const id of playerIds) fastest = Math.max(fastest, speedAt(frames, index, id));
    }
    expect(fastest).toBeLessThanOrEqual(SIM_LIMITS.sprint + 0.01);
  });

  // Given the ball on the move, then the players around it move too — most of
  // those not acting out the play, not just the one with the ball (T6).
  it("moves most of the team while the ball moves", () => {
    const counts: number[] = [];
    for (let index = 40; index < frames.length; index++) {
      const ballSpeed =
        (distance(frames[index].sim.ball, frames[index - 1].sim.ball) / FRAME_MS) * 1000;
      if (ballSpeed < 3) continue;
      const movers = frames[index].playback.scene.movers;
      counts.push(
        playerIds.filter((id) => !(id in movers) && speedAt(frames, index, id) > 0.3).length,
      );
    }
    counts.sort((a, b) => a - b);
    expect(counts[Math.floor(counts.length / 2)]).toBeGreaterThanOrEqual(10);
  });

  // Given play running, including a lull with nothing queued, then there is
  // never a whole second in which all 22 stand still (T7).
  it("never freezes the whole pitch for a second", () => {
    let stillFrames = 0;
    let longest = 0;
    for (let index = 1; index < frames.length; index++) {
      const allStill = playerIds.every((id) => speedAt(frames, index, id) < 0.2);
      stillFrames = allStill ? stillFrames + 1 : 0;
      longest = Math.max(longest, stillFrames);
    }
    expect(longest * FRAME_MS).toBeLessThan(1000);
  });

  // Given the ball's path, then it only ever travels — at most at a shot's pace —
  // and never jumps from one place to another (T8).
  it("never moves the ball faster than a shot", () => {
    for (let index = 1; index < frames.length; index++) {
      const metresPerSecond =
        (distance(frames[index].sim.ball, frames[index - 1].sim.ball) / FRAME_MS) * 1000;
      expect(metresPerSecond).toBeLessThanOrEqual(30);
    }
  });

  // Given team-mates drifting into shape, then they never pile onto each other.
  it("keeps team-mates apart", () => {
    let closest = Number.POSITIVE_INFINITY;
    for (const { sim, playback } of frames) {
      for (const team of [homeIds, awayIds]) {
        const shaping = team.filter((id) => !(id in playback.scene.movers));
        for (const [index, id] of shaping.entries()) {
          for (const other of shaping.slice(index + 1)) {
            closest = Math.min(closest, distance(sim.players[id].at, sim.players[other].at));
          }
        }
      }
    }
    expect(closest).toBeGreaterThanOrEqual(1.5);
  });
});

describe("radar simulation — meeting the ball", () => {
  // Given a pass, then when it arrives the receiver is there to take it (T3).
  it("has the receiver at the ball when the pass arrives", () => {
    const frames = simulate([
      radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
      radarEvent("Dribble", "Home", "AwayDefense", "h_st2"),
    ]);
    const arrival = frames.findIndex(({ playback }) => playback.beat?.beat.eventType === "Dribble");
    const { sim } = frames[arrival - 1];
    expect(distance(sim.ball, sim.players.h_st2.at)).toBeLessThan(2);
  });
});

describe("radar simulation — acting out the play", () => {
  // Given a man the script sends 14 m in two seconds, then he gets there when
  // the script says — halfway at one second, on his mark at two — neither
  // sprinting ahead nor easing in late.
  it("gets a man to his mark when the script says", () => {
    const from = stage.positionAt("h_st1", focusOf(start)) ?? start.ball;
    const mark = { x: from.x + 14, y: from.y };
    let playback = enqueueBeats(
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
    let sim = restingSim(stage, start);
    /** Where he is after `ms` more of play. */
    const at = (ms: number) => {
      for (let elapsed = 0; elapsed < ms - 1e-9; elapsed += FRAME_MS) {
        playback = advancePlayback(playback, FRAME_MS);
        sim = stepSim(sim, stage, playback, FRAME_MS, { idle: false });
      }
      return sim.players.h_st1.at;
    };
    const oneSecondIn = at(1000);
    expect(distance(oneSecondIn, from)).toBeCloseTo(7, 0);
    const twoSecondsIn = at(1000);
    expect(distance(twoSecondsIn, mark)).toBeLessThan(0.1);
  });
});

describe("radar simulation — reacting", () => {
  // Given everyone at rest and the ball set moving, then team-mates react one
  // after another, each a moment later than the last — no two set off in the
  // same frame (T11). Setting off is the first movement at all, however slow.
  it("staggers when team-mates set off", () => {
    const frames = simulate([radarEvent("Dribble", "Home", "AwayDefense", "h_st1")], {
      idle: false,
    });
    for (const team of [homeIds, awayIds]) {
      const firstMoves = team
        .map((id) => frames.findIndex((_, index) => index > 0 && speedAt(frames, index, id) > 0.05))
        .filter((index) => index > 0);
      expect(firstMoves.length).toBeGreaterThanOrEqual(8);
      expect(new Set(firstMoves).size).toBe(firstMoves.length);
    }
  });
});
