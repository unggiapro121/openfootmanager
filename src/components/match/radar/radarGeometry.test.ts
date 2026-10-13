import { describe, expect, it } from "vitest";

import {
  CENTRE_LANE,
  GOAL_HALF_WIDTH,
  HALFWAY,
  PITCH_LENGTH,
  PITCH_WIDTH,
  type ShapeFocus,
  type Side,
  distance,
  fromPitch,
  kitNumberTone,
  pickRadarKits,
  shapePositions,
  toPitch,
  zoneAhead,
  zoneCentreX,
} from "./radarGeometry";
import { radarTeam } from "./radarTestFixtures";

/** The ball at `x` along the pitch (in the centre lane unless given), `possession`'s ball. */
function ballAt(x: number, possession: Side = "Home", y = CENTRE_LANE): ShapeFocus {
  return { x, y, possession };
}

/** Front to back of a side's outfield block, in metres along the pitch. */
function lengthOf(positions: Map<string, { x: number; y: number }>, keeper: string): number {
  const xs = [...positions].filter(([id]) => id !== keeper).map(([, at]) => at.x);
  return Math.max(...xs) - Math.min(...xs);
}

function lanesOf(positions: Map<string, { x: number; y: number }>, ids: string[]): number[] {
  return ids.map((id) => positions.get(id)?.y ?? Number.NaN);
}

describe("radar pitch coordinates", () => {
  // Given a point seen from the away end, when it is put on the shared pitch,
  // then it is the home view turned round, and reading it back gives the same point.
  it("turns the away side's view round and back", () => {
    expect(toPitch("Home", 10, 5)).toEqual({ x: 10, y: 5 });
    expect(toPitch("Away", 10, 5)).toEqual({ x: PITCH_LENGTH - 10, y: PITCH_WIDTH - 5 });
    expect(fromPitch("Away", toPitch("Away", 30, 12))).toEqual({ depth: 30, lane: 12 });
  });

  // Given the engine's five zones, then they run from the home goal to the away goal,
  // and the zone ahead of a side is the next one towards the goal it attacks.
  it("orders the engine zones goal to goal", () => {
    const xs = ["HomeBox", "HomeDefense", "Midfield", "AwayDefense", "AwayBox"].map(zoneCentreX);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(zoneCentreX("Nowhere")).toBe(HALFWAY);
    expect(zoneAhead("Home", "Midfield")).toBe("AwayDefense");
    expect(zoneAhead("Away", "Midfield")).toBe("HomeDefense");
    expect(zoneAhead("Home", "AwayBox")).toBe("AwayBox");
  });
});

describe("shapePositions", () => {
  // Given a 4-4-2 with the ball on the halfway line, then every player has a
  // position, the keeper stands in front of his own goal and the strikers are
  // the furthest forward.
  it("draws the side in its formation", () => {
    const home = shapePositions(radarTeam("h"), "Home", [], ballAt(HALFWAY));
    expect(home.size).toBe(11);
    const keeper = home.get("h_gk");
    expect(keeper?.x).toBeLessThan(12);
    expect(keeper?.y).toBe(CENTRE_LANE);
    const striker = home.get("h_st1")?.x ?? 0;
    const centreBack = home.get("h_cb1")?.x ?? 0;
    expect(striker).toBeGreaterThan(centreBack);
  });

  // Given the same shape for the away side, then it defends the other goal.
  it("puts the away side at the other end", () => {
    const away = shapePositions(radarTeam("a"), "Away", [], ballAt(HALFWAY));
    expect(away.get("a_gk")?.x).toBeGreaterThan(PITCH_LENGTH - 12);
    expect(away.get("a_st1")?.x ?? 0).toBeLessThan(away.get("a_cb1")?.x ?? 0);
  });

  // Given the ball moving from the home box to the away box, then the whole home
  // block moves up the pitch with it.
  it("slides the block with the ball", () => {
    const deep = shapePositions(radarTeam("h"), "Home", [], ballAt(zoneCentreX("HomeBox")));
    const high = shapePositions(radarTeam("h"), "Home", [], ballAt(zoneCentreX("AwayBox")));
    for (const id of ["h_cb1", "h_cm1", "h_st1"]) {
      expect(high.get(id)?.x ?? 0).toBeGreaterThan(deep.get(id)?.x ?? 0);
    }
  });

  // Given a manager who asks for a high defensive line, then his back four
  // stand 15% of the pitch higher than on a medium line.
  it("pushes a high defensive line up the pitch", () => {
    const medium = shapePositions(
      radarTeam("h", { defensive_line: "Medium" }),
      "Home",
      [],
      ballAt(40),
    );
    const high = shapePositions(radarTeam("h", { defensive_line: "High" }), "Home", [], ballAt(40));
    const rise = (high.get("h_cb1")?.x ?? 0) - (medium.get("h_cb1")?.x ?? 0);
    expect(rise).toBeCloseTo(PITCH_LENGTH * 0.15, 5);
  });

  // Given a manager who asks for width, then his wide men hug the touchlines
  // more than with normal width, and less with a narrow shape.
  it("stretches a wide side towards the touchlines", () => {
    const spreadOf = (width: "Narrow" | "Normal" | "Wide") => {
      const shape = shapePositions(radarTeam("h", { width }), "Home", [], ballAt(HALFWAY));
      const [left, right] = lanesOf(shape, ["h_lm", "h_rm"]);
      return Math.abs(right - left);
    };
    expect(spreadOf("Wide")).toBeGreaterThan(spreadOf("Normal"));
    expect(spreadOf("Normal")).toBeGreaterThan(spreadOf("Narrow"));
  });

  // Given the same ball, then a side that has it pushes on and stretches long
  // and wide, and a side without it drops off and squeezes up.
  it("stretches a side with the ball and squeezes it without", () => {
    const withBall = shapePositions(radarTeam("h"), "Home", [], ballAt(HALFWAY, "Home"));
    const without = shapePositions(radarTeam("h"), "Home", [], ballAt(HALFWAY, "Away"));
    expect(lengthOf(withBall, "h_gk")).toBeGreaterThan(lengthOf(without, "h_gk"));
    const [wideLeft, wideRight] = lanesOf(withBall, ["h_lm", "h_rm"]);
    const [tightLeft, tightRight] = lanesOf(without, ["h_lm", "h_rm"]);
    expect(Math.abs(wideRight - wideLeft)).toBeGreaterThan(Math.abs(tightRight - tightLeft));
    expect(withBall.get("h_cb1")?.x ?? 0).toBeGreaterThan(without.get("h_cb1")?.x ?? 0);
  });

  // Given the home side attacking 25 m further up the pitch, then it stretches
  // while the away side, defending its own goal, squeezes the space between its
  // lines: the two blocks no longer move as one.
  it("stretches the attack and squeezes the defence as the ball goes forward", () => {
    const at = (x: number) => ({
      home: lengthOf(shapePositions(radarTeam("h"), "Home", [], ballAt(x, "Home")), "h_gk"),
      away: lengthOf(shapePositions(radarTeam("a"), "Away", [], ballAt(x, "Home")), "a_gk"),
    });
    const before = at(HALFWAY);
    const after = at(HALFWAY + 25);
    expect(after.home).toBeGreaterThan(before.home);
    expect(after.away).toBeLessThan(before.away);
  });

  // Given the ball out by a touchline, then a side without it slides across to
  // that flank, and its keeper edges towards that post without leaving his goal.
  it("slides across to the ball's flank", () => {
    const meanLane = (shape: Map<string, { x: number; y: number }>) => {
      const lanes = [...shape].filter(([id]) => id !== "a_gk").map(([, at]) => at.y);
      return lanes.reduce((sum, lane) => sum + lane, 0) / lanes.length;
    };
    const central = shapePositions(radarTeam("a"), "Away", [], ballAt(70, "Home"));
    const wide = shapePositions(radarTeam("a"), "Away", [], ballAt(70, "Home", 6));
    expect(meanLane(central) - meanLane(wide)).toBeGreaterThan(5);
    const keeper = wide.get("a_gk")?.y ?? CENTRE_LANE;
    expect(keeper).toBeLessThan(CENTRE_LANE);
    expect(CENTRE_LANE - keeper).toBeLessThan(GOAL_HALF_WIDTH);
  });

  // Given the ball anywhere on the pitch, with either side on it, then each
  // block stays between 15 and 45 m long and no two team-mates stand on top of
  // each other.
  it("keeps every block in shape wherever the ball is", () => {
    for (let x = 0; x <= PITCH_LENGTH; x += 7.5) {
      for (const y of [4, CENTRE_LANE, PITCH_WIDTH - 4]) {
        for (const possession of ["Home", "Away"] as const) {
          for (const [side, prefix] of [
            ["Home", "h"],
            ["Away", "a"],
          ] as const) {
            const shape = shapePositions(radarTeam(prefix), side, [], ballAt(x, possession, y));
            const length = lengthOf(shape, `${prefix}_gk`);
            expect(length, `${side} at ${x},${y}`).toBeGreaterThanOrEqual(15);
            expect(length, `${side} at ${x},${y}`).toBeLessThanOrEqual(45);
            const points = [...shape.values()];
            for (const [index, point] of points.entries()) {
              for (const other of points.slice(index + 1)) {
                expect(distance(point, other)).toBeGreaterThanOrEqual(2);
              }
            }
          }
        }
      }
    }
  });

  // Given a sent-off player, then he is not drawn on the pitch.
  it("leaves a sent-off player off the pitch", () => {
    const shape = shapePositions(radarTeam("h"), "Home", ["h_cb2"], ballAt(HALFWAY));
    expect(shape.has("h_cb2")).toBe(false);
    expect(shape.size).toBe(10);
  });
});

describe("pickRadarKits", () => {
  // Given two sides in clearly different colours, then each wears its own.
  it("keeps two different first-choice colours", () => {
    expect(
      pickRadarKits(
        { primary: "#c8102e", secondary: "#ffffff" },
        { primary: "#1d4ed8", secondary: "#ffffff" },
      ),
    ).toEqual({ home: "#c8102e", away: "#1d4ed8" });
  });

  // Given two red sides, then the visitors change into their second colour.
  it("changes the visitors' strip on a clash", () => {
    expect(
      pickRadarKits(
        { primary: "#c8102e", secondary: "#ffffff" },
        { primary: "#d0112b", secondary: "#111111" },
      ),
    ).toEqual({ home: "#c8102e", away: "#111111" });
  });

  // Given a clash the change strip cannot solve, then the visitors fall back to
  // the theme colour rather than wearing the home kit.
  it("falls back to the theme when nothing else separates them", () => {
    expect(
      pickRadarKits(
        { primary: "#c8102e", secondary: "#ffffff" },
        { primary: "#d0112b", secondary: "#c8102e" },
      ).away,
    ).toBeNull();
  });

  // Given a light and a dark kit, then the number on each reads against it.
  it("prints dark numbers on light kits and light on dark", () => {
    expect(kitNumberTone("#ffffff")).toBe("dark");
    expect(kitNumberTone("#0a1128")).toBe("light");
    expect(kitNumberTone(null)).toBe("light");
  });
});
