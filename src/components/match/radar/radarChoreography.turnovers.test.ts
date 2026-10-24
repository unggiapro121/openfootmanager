import { describe, expect, it } from "vitest";

import type { MatchEvent } from "../types";

import { choreographBatch } from "./radarChoreography";
import { type RadarScene, applyStep, initialRadarScene } from "./radarScene";
import { buildRadarStage } from "./radarStage";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";

const snapshot = radarSnapshot();
const stage = buildRadarStage(snapshot);
const start = initialRadarScene(snapshot);

/** The scene as each step of `events`' beats comes on, with the beat's event type. */
function scenesOf(events: MatchEvent[]): Array<{ eventType: string; scene: RadarScene }> {
  const { beats } = choreographBatch(events, stage, start);
  const scenes: Array<{ eventType: string; scene: RadarScene }> = [];
  let scene = start;
  for (const beat of beats) {
    for (const step of beat.steps) {
      scene = applyStep(scene, step);
      scenes.push({ eventType: beat.eventType, scene });
    }
  }
  return scenes;
}

/** Whether `playerId` is held in place on some step of the beats of `eventType`. */
const isHeldDuring = (events: MatchEvent[], eventType: string, playerId: string) =>
  scenesOf(events).some((entry) => entry.eventType === eventType && playerId in entry.scene.movers);

/** The other side's attack after it wins the ball: a shot from the edge of the box. */
const counterShot = radarEvent("ShotBlocked", "Away", "HomeBox", "a_st1");

describe("choreographBatch — the man who loses the ball", () => {
  // Given a dribbler tackled, and the side that won it going on to a shot,
  // when the play is staged, then the dribbler is not held where he lost the
  // ball while the shot is played: he takes up his place in the shape again.
  it("lets a tackled dribbler go while the other side attacks", () => {
    const events = [
      radarEvent("DribbleTackled", "Home", "AwayDefense", "h_st1", "a_cb1"),
      radarEvent("Tackle", "Away", "AwayDefense", "a_cb1"),
      counterShot,
    ];
    expect(isHeldDuring(events, "DribbleTackled", "h_st1")).toBe(true);
    expect(isHeldDuring(events, "ShotBlocked", "h_st1")).toBe(false);
  });

  // Given a man running with the ball who is then tackled, and a shot from
  // the side that won it, then he is not held where he lost it during the shot.
  it("lets a man go once he is tackled", () => {
    const events = [
      radarEvent("Dribble", "Home", "Midfield", "h_cm1"),
      radarEvent("Tackle", "Away", "Midfield", "a_cm1"),
      counterShot,
    ];
    expect(isHeldDuring(events, "Tackle", "h_cm1")).toBe(true);
    expect(isHeldDuring(events, "ShotBlocked", "h_cm1")).toBe(false);
  });

  // Given a pass cut out, and a shot from the side that cut it out, then the
  // passer is not held where he played it during the shot.
  it("lets a passer go once his pass is cut out", () => {
    const events = [
      radarEvent("PassIntercepted", "Home", "Midfield", "h_cm2"),
      radarEvent("Interception", "Away", "Midfield", "a_cm2"),
      counterShot,
    ];
    expect(isHeldDuring(events, "PassIntercepted", "h_cm2")).toBe(true);
    expect(isHeldDuring(events, "ShotBlocked", "h_cm2")).toBe(false);
  });

  // Given a loose ball the other side wins, and a shot from it, then the man
  // who lost the race for it is not held where he lost it during the shot.
  it("lets the man who lost a loose ball go", () => {
    const events = [radarEvent("BallRecovery", "Away", "Midfield", "a_cm1", "h_cm1"), counterShot];
    expect(isHeldDuring(events, "BallRecovery", "h_cm1")).toBe(true);
    expect(isHeldDuring(events, "ShotBlocked", "h_cm1")).toBe(false);
  });
});
