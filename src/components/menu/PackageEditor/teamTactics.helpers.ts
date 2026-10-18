import { getRolesForPosition } from "../../../lib/playerRoles";
import type { PlayerRole, TeamMatchRolesData } from "../../../store/types";
import { buildPitchRows } from "../../squad/SquadTab.helpers";
import type { TeamTacticsDef } from "./types";

/** The positions of `formation`'s slots, in slot order: entry `i` is slot `i`. */
export function slotPositions(formation: string): string[] {
  return buildPitchRows(formation).flatMap((row) => row.positions);
}

/** How many slots of the side have a player in them. */
export function filledStarters(tactics: TeamTacticsDef): number {
  return (tactics.startingXi ?? []).filter((id) => id !== "").length;
}

/** `startingXi` stretched or cut to exactly `size` slots. */
function sized(eleven: string[] | undefined, size: number): string[] {
  return Array.from({ length: size }, (_, slot) => eleven?.[slot] ?? "");
}

/**
 * The roles that still hold: a role belongs to a starter, and only where his
 * slot admits it — the rule the game applies when it fields him.
 */
function rolesThatFit(
  roles: TeamTacticsDef["playerRoles"],
  eleven: string[],
  formation: string,
): NonNullable<TeamTacticsDef["playerRoles"]> {
  const slots = slotPositions(formation);
  const kept: NonNullable<TeamTacticsDef["playerRoles"]> = {};
  eleven.forEach((playerId, slot) => {
    const role = playerId ? roles?.[playerId] : undefined;
    if (role && getRolesForPosition(slots[slot] ?? "").includes(role)) {
      kept[playerId] = role;
    }
  });
  return kept;
}

/**
 * The tactics in `formation`, or with no shape of their own when it is null.
 * The side keeps its players slot by slot, as the game's own shape change does;
 * without a shape there are no slots, so the side and its roles go too.
 */
export function withFormation(tactics: TeamTacticsDef, formation: string | null): TeamTacticsDef {
  const { formation: _old, startingXi: _xi, playerRoles: _roles, ...rest } = tactics;
  if (!formation) return rest;
  const eleven = sized(tactics.startingXi, slotPositions(formation).length);
  return {
    ...rest,
    formation,
    startingXi: eleven,
    playerRoles: rolesThatFit(tactics.playerRoles, eleven, formation),
  };
}

/**
 * `playerId` in slot `slot` (`""` empties it). A player already in the side
 * moves, and the one he displaces takes his old slot — a swap, as on the
 * game's pitch, so nobody is ever named twice.
 */
export function withStarter(
  tactics: TeamTacticsDef,
  slot: number,
  playerId: string,
): TeamTacticsDef {
  const formation = tactics.formation;
  if (!formation) return tactics;
  const eleven = sized(tactics.startingXi, slotPositions(formation).length);
  const previousSlot = playerId ? eleven.indexOf(playerId) : -1;
  if (previousSlot >= 0) eleven[previousSlot] = eleven[slot] ?? "";
  eleven[slot] = playerId;
  return {
    ...tactics,
    startingXi: eleven,
    playerRoles: rolesThatFit(tactics.playerRoles, eleven, formation),
  };
}

/** `role` for `playerId`; `Standard` — no role — is left out. */
export function withRole(
  tactics: TeamTacticsDef,
  playerId: string,
  role: PlayerRole,
): TeamTacticsDef {
  const { [playerId]: _old, ...others } = tactics.playerRoles ?? {};
  return {
    ...tactics,
    playerRoles: role === "Standard" ? others : { ...others, [playerId]: role },
  };
}

const NO_MATCH_ROLES: TeamMatchRolesData = {
  captain: null,
  vice_captain: null,
  penalty_taker: null,
  free_kick_taker: null,
  corner_taker: null,
};

export const MATCH_ROLE_KEYS = Object.keys(NO_MATCH_ROLES) as (keyof TeamMatchRolesData)[];

/** `playerId` (or nobody) as the club's `role`. */
export function withMatchRole(
  tactics: TeamTacticsDef,
  role: keyof TeamMatchRolesData,
  playerId: string | null,
): TeamTacticsDef {
  return {
    ...tactics,
    matchRoles: { ...NO_MATCH_ROLES, ...tactics.matchRoles, [role]: playerId },
  };
}

/**
 * The tactics as they are saved: only what the author chose. Nothing chosen at
 * all is no `tactics`, so an untouched club is written exactly as before.
 */
export function compactTactics(tactics: TeamTacticsDef): TeamTacticsDef | undefined {
  const compact: TeamTacticsDef = {};
  if (tactics.formation) compact.formation = tactics.formation;
  if (tactics.startingXi?.some((id) => id !== "")) compact.startingXi = tactics.startingXi;
  if (tactics.playerRoles && Object.keys(tactics.playerRoles).length > 0) {
    compact.playerRoles = tactics.playerRoles;
  }
  if (tactics.matchRoles && Object.values(tactics.matchRoles).some((id) => id)) {
    compact.matchRoles = tactics.matchRoles;
  }
  if (tactics.phase) compact.phase = tactics.phase;
  return Object.keys(compact).length > 0 ? compact : undefined;
}
