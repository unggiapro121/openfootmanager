import type { MatchSnapshot } from "../types";
import {
  type PitchPoint,
  type ShapeFocus,
  type ShapeSlot,
  type Side,
  formationSlots,
  fromPitch,
  placeShape,
  toPitch,
} from "./radarGeometry";
import { type RadarScene, focusOf } from "./radarScene";

/** Who is on the pitch for the radar, and where the shapes put them. */

export type LineGroup = "Defender" | "Midfielder" | "Forward";

export interface RadarStage {
  sideOf(playerId: string): Side | null;
  positionAt(playerId: string, focus: ShapeFocus): PitchPoint | null;
  /** Both sides' shapes around `focus`. */
  shapeAt(focus: ShapeFocus): Map<string, PitchPoint>;
  /** The on-pitch players of one line of a side, in slot order. */
  line(side: Side, group: LineGroup): string[];
  goalkeeper(side: Side): string | null;
}

/** The parts of a snapshot that say who is on the pitch and how each side is set up. */
export type RadarLineups = Pick<MatchSnapshot, "home_team" | "away_team" | "sent_off">;

/** A key that changes exactly when the stage would: a substitution, a formation, a dial. */
export function lineupsKey({ home_team, away_team, sent_off }: RadarLineups): string {
  const sideKey = (team: RadarLineups["home_team"]) =>
    `${team.formation}:${team.players.map((player) => player.id).join(",")}:${team.tactics?.defensive_line}:${team.tactics?.width}`;
  return `${sideKey(home_team)}|${sideKey(away_team)}|${(sent_off ?? []).join(",")}`;
}

/** Recent shapes kept, so a step that asks for the same focus many times works it out once. */
const SHAPES_KEPT = 64;

/**
 * The shapes with nobody standing offside (after GĐ5): no outfield man of
 * either side further up than the other side's last outfield man or the
 * ball. The dials stretch each block on its own — a high line pushes a side's
 * forwards up, a low one drops the other back line — and the flag is only
 * ever raised by a ball played to a runner, which the beat acts out.
 */
function keptOnside(
  shape: Map<string, PitchPoint>,
  focus: ShapeFocus,
  sides: Map<string, Side>,
  keepers: Set<string>,
): Map<string, PitchPoint> {
  const sideOf = (id: string) => sides.get(id) ?? null;
  const kept = new Map(shape);
  for (const attacking of ["Home", "Away"] as const) {
    const defending = attacking === "Home" ? "Away" : "Home";
    const backLine = Math.max(
      ...[...shape.entries()]
        .filter(([id]) => sideOf(id) === defending && !keepers.has(id))
        .map(([, at]) => fromPitch(attacking, at).depth),
    );
    const limit = Math.max(backLine, fromPitch(attacking, focus).depth);
    for (const [id, at] of shape) {
      if (sideOf(id) !== attacking || keepers.has(id)) continue;
      const { depth, lane } = fromPitch(attacking, at);
      if (depth > limit) kept.set(id, toPitch(attacking, limit, lane));
    }
  }
  return kept;
}

export function buildRadarStage(snapshot: RadarLineups): RadarStage {
  const sentOff = snapshot.sent_off ?? [];
  const teams: { side: Side; team: RadarLineups["home_team"]; slots: ShapeSlot[] }[] = [
    { side: "Home", team: snapshot.home_team, slots: formationSlots(snapshot.home_team, sentOff) },
    { side: "Away", team: snapshot.away_team, slots: formationSlots(snapshot.away_team, sentOff) },
  ];
  const sides = new Map<string, Side>();
  const groups = new Map<string, string>();
  for (const { side, team } of teams) {
    for (const player of team.players) {
      if (sentOff.includes(player.id)) continue;
      sides.set(player.id, side);
      groups.set(player.id, player.position);
    }
  }
  const keepers = new Set(
    [...groups.entries()].filter(([, group]) => group === "Goalkeeper").map(([id]) => id),
  );
  const shapes = new Map<string, Map<string, PitchPoint>>();
  const shapeAt = (focus: ShapeFocus) => {
    const key = `${focus.x.toFixed(1)}:${focus.y.toFixed(1)}:${focus.possession}`;
    let shape = shapes.get(key);
    if (!shape) {
      shape = keptOnside(
        new Map(
          teams.flatMap(({ side, team, slots }) => [...placeShape(slots, team, side, focus)]),
        ),
        focus,
        sides,
        keepers,
      );
      if (shapes.size >= SHAPES_KEPT) shapes.clear();
      shapes.set(key, shape);
    }
    return shape;
  };
  const membersOf = (side: Side, group: string) =>
    [...sides.entries()]
      .filter(([id, playerSide]) => playerSide === side && groups.get(id) === group)
      .map(([id]) => id);
  return {
    sideOf: (playerId) => sides.get(playerId) ?? null,
    positionAt: (playerId, focus) => shapeAt(focus).get(playerId) ?? null,
    shapeAt,
    line: (side, group) => membersOf(side, group),
    goalkeeper: (side) => membersOf(side, "Goalkeeper")[0] ?? null,
  };
}

/** Where everyone is drawn in `scene`: their place in the shape, unless acting out the beat. */
export function scenePositions(stage: RadarStage, scene: RadarScene): Map<string, PitchPoint> {
  const positions = new Map(stage.shapeAt(focusOf(scene)));
  for (const [id, point] of Object.entries(scene.movers)) {
    if (positions.has(id)) positions.set(id, point);
  }
  return positions;
}

/** Where `playerId` is drawn in `scene`, or null when he is not on the pitch. */
export function standingIn(
  stage: RadarStage,
  scene: RadarScene,
  playerId: string,
): PitchPoint | null {
  return scene.movers[playerId] ?? stage.positionAt(playerId, focusOf(scene));
}
