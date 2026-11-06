import type { TeamData } from "../../../store/types";
import type { TeamTacticsDef } from "./types";

/**
 * The club the tactics board shows: `preview` — the club as the world would
 * open it on its own (`preview_package_club`) — with the play style the form
 * holds now and every part of `tactics` the author set laid over it.
 */
export function boardTeam(
  preview: TeamData,
  playStyle: string,
  tactics: TeamTacticsDef | null | undefined,
): TeamData {
  return {
    ...preview,
    play_style: playStyle,
    formation: tactics?.formation ?? preview.formation,
    starting_xi_ids: tactics?.startingXi ?? [],
    player_roles: { ...preview.player_roles, ...tactics?.playerRoles } as TeamData["player_roles"],
    match_roles: tactics?.matchRoles ?? preview.match_roles,
    tactics_phase: tactics?.phase ?? preview.tactics_phase,
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
