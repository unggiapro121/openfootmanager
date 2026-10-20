import { invoke } from "./transport";

import type { GameStateData, PlayerData, TeamMatchRolesData } from "../store/gameStore";
import type {
  PlayerRole,
  PlayerSquadRole,
  PositionRating,
  TacticsPhaseSettings,
} from "../store/types";

export async function getSquad(teamId: string): Promise<PlayerData[]> {
  return invoke<PlayerData[]>("get_squad", { teamId });
}

/**
 * Each player of `teamId` rated at every pitch position, by player id — the
 * ratings a match is played at, so a player out of position shows as he would
 * play there.
 */
export async function getSquadPositionRatings(
  teamId: string,
): Promise<Record<string, PositionRating[]>> {
  return invoke<Record<string, PositionRating[]>>("get_squad_position_ratings", { teamId });
}

export async function setPlayerSquadRole(
  playerId: string,
  squadRole: PlayerSquadRole,
): Promise<GameStateData> {
  return invoke<GameStateData>("set_player_squad_role", {
    playerId,
    squadRole,
  });
}

export async function setStartingXi(playerIds: string[]): Promise<GameStateData> {
  return invoke<GameStateData>("set_starting_xi", { playerIds });
}

/** Switch the managed club to `formation`, e.g. "4-3-3". */
export async function setFormation(formation: string): Promise<GameStateData> {
  return invoke<GameStateData>("set_formation", { formation });
}

/** Set the managed club's overall play style. */
export async function setPlayStyle(playStyle: string): Promise<GameStateData> {
  return invoke<GameStateData>("set_play_style", { playStyle });
}

/** Name the managed club's captain and set-piece takers. */
export async function setTeamMatchRoles(matchRoles: TeamMatchRolesData): Promise<GameStateData> {
  return invoke<GameStateData>("set_team_match_roles", { matchRoles });
}

export async function setPlayerRole(
  playerId: string,
  role: PlayerRole | null,
): Promise<GameStateData> {
  return invoke<GameStateData>("set_player_role", {
    playerId,
    role: role ?? undefined,
  });
}

/**
 * Give a player a shirt number, or take it away with `null`. A number someone
 * else in the squad wears is refused unless `swapWithHolder` is set, in which
 * case the holder takes the player's old number (or none).
 */
export async function assignJerseyNumber(
  playerId: string,
  jerseyNumber: number | null,
  swapWithHolder = false,
): Promise<GameStateData> {
  return invoke<GameStateData>("assign_jersey_number", {
    playerId,
    jerseyNumber,
    swapWithHolder,
  });
}

export async function setTacticsPhase(
  patch: Partial<TacticsPhaseSettings>,
): Promise<GameStateData> {
  return invoke<GameStateData>("set_tactics_phase", {
    buildUpStyle: patch.build_up_style,
    width: patch.width,
    tempo: patch.tempo,
    defensiveLine: patch.defensive_line,
    pressingIntensity: patch.pressing_intensity,
    defensiveShape: patch.defensive_shape,
    markingStyle: patch.marking_style,
    counterPressDuration: patch.counter_press_duration,
    breakSpeed: patch.break_speed,
    crossStyle: patch.cross_style,
    offsideTrap: patch.offside_trap,
  });
}
