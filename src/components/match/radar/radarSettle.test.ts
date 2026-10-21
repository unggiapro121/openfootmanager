import { describe, expect, it } from "vitest";

import { applyStep, initialRadarScene } from "./radarScene";
import { type RadarSettle, quietSteps, settleStepsFor } from "./radarSettle";
import { buildRadarStage } from "./radarStage";
import { radarSnapshot } from "./radarTestFixtures";

const snapshot = radarSnapshot();
const stage = buildRadarStage(snapshot);
const start = initialRadarScene(snapshot);

function after(steps: ReturnType<typeof quietSteps> | null, from = start) {
  return (steps ?? []).reduce((scene, step) => applyStep(scene, step), from);
}

describe("radarSettle — the engine's lane (phase 2, GĐ5 P5.6)", () => {
  // Given a quiet minute (after GĐ5), then nothing is acted out: the ball
  // stays where it is, wherever the engine left it.
  it("leaves a quiet minute's ball where it is", () => {
    const scene = after(quietSteps());
    expect(scene.ball).toEqual(start.ball);
    expect(scene.possession).toBe(start.possession);
  });

  it("moves a ball already in the right zone over to the engine's lane", () => {
    const inZone = { ...start, ball: { x: start.ball.x, y: 34 } };
    const settle: RadarSettle = {
      ballZone: snapshot.ball_zone,
      possession: "Home",
      ballLane: "Right",
    };
    const steps = settleStepsFor(stage, inZone, settle);
    expect(steps).not.toBeNull();
    expect(after(steps, inZone).ball.y).toBeGreaterThan(45.3);
  });

  it("leaves the ball where it is across the pitch when the engine names no lane", () => {
    const inZone = { ...start, ball: { x: start.ball.x, y: 30 } };
    const settle: RadarSettle = { ballZone: snapshot.ball_zone, possession: "Home" };
    expect(settleStepsFor(stage, inZone, settle)).toBeNull();
  });
});
