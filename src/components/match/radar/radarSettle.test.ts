import { describe, expect, it } from "vitest";

import { applyStep, focusOf, initialRadarScene } from "./radarScene";
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
  it("puts a quiet minute's ball on the home side's left when the engine plays there", () => {
    const settle: RadarSettle = { ballZone: "AwayDefense", possession: "Home", ballLane: "Left" };
    const scene = after(quietSteps(stage, start, settle));
    // The home side attacks left to right with its left touchline at y = 0.
    expect(scene.ball.y).toBeLessThan(22.7);
    expect(focusOf(scene).y).toBe(scene.ball.y);
  });

  it("reads the lane from the away side's end when the away side has the ball", () => {
    const settle: RadarSettle = { ballZone: "HomeDefense", possession: "Away", ballLane: "Left" };
    const scene = after(quietSteps(stage, start, settle));
    expect(scene.ball.y).toBeGreaterThan(45.3);
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
