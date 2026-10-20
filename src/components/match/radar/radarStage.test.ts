import { describe, expect, it } from "vitest";

import { fromPitch } from "./radarGeometry";
import { buildRadarStage } from "./radarStage";
import { radarSnapshot, radarTeam } from "./radarTestFixtures";

// The home side pushes its line up and the away side sits deep: the shapes
// alone would put the home forwards well beyond the away back line.
const snapshot = radarSnapshot({
  home_team: radarTeam("h", { defensive_line: "High" }),
  away_team: radarTeam("a", { defensive_line: "Low" }),
});
const stage = buildRadarStage(snapshot);

/** The deepest outfield man of `side` in `attacking`'s view: its last defender. */
function lastDefenderDepth(
  shape: Map<string, { x: number; y: number }>,
  defending: "Home" | "Away",
  attacking: "Home" | "Away",
): number {
  const keeper = stage.goalkeeper(defending);
  return Math.max(
    ...[...shape.entries()]
      .filter(([id]) => stage.sideOf(id) === defending && id !== keeper)
      .map(([, at]) => fromPitch(attacking, at).depth),
  );
}

describe("buildRadarStage — nobody stands offside in the shape (after GĐ5)", () => {
  // Given the home side on the ball deep in the away half, then no home
  // player stands beyond the last away defender or the ball, wherever the
  // shapes would have put him.
  it("keeps the attacking side level with the last defender", () => {
    for (const x of [70, 80, 90]) {
      const shape = stage.shapeAt({ x, y: 34, possession: "Home" });
      const line = Math.max(lastDefenderDepth(shape, "Away", "Home"), x);
      for (const [id, at] of shape) {
        if (stage.sideOf(id) !== "Home") continue;
        expect(fromPitch("Home", at).depth, `${id} at x ${x}`).toBeLessThanOrEqual(line + 1e-9);
      }
    }
  });

  // Given the away side on the ball deep in the home half, then the same
  // holds the other way round.
  it("keeps the away side level with the last home defender", () => {
    const shape = stage.shapeAt({ x: 20, y: 34, possession: "Away" });
    const line = Math.max(
      lastDefenderDepth(shape, "Home", "Away"),
      fromPitch("Away", { x: 20, y: 34 }).depth,
    );
    for (const [id, at] of shape) {
      if (stage.sideOf(id) !== "Away") continue;
      expect(fromPitch("Away", at).depth, id).toBeLessThanOrEqual(line + 1e-9);
    }
  });
});
