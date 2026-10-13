import type { MatchSnapshot } from "../types";
import {
  type PitchPoint,
  type ShapeFocus,
  type ShapeSlot,
  type Side,
  formationSlots,
  placeShape,
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
  const shapes = new Map<string, Map<string, PitchPoint>>();
  const shapeAt = (focus: ShapeFocus) => {
    const key = `${focus.x.toFixed(1)}:${focus.y.toFixed(1)}:${focus.possession}`;
    let shape = shapes.get(key);
    if (!shape) {
      shape = new Map(
        teams.flatMap(({ side, team, slots }) => [...placeShape(slots, team, side, focus)]),
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
