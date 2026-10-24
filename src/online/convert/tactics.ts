import type {
  TacticsBoardTeam,
  TacticsRosterPlayer,
} from "../../components/tactics/tacticsBoardSource";
import type {
  PlayerRole,
  PositionRating,
  TacticsPhaseSettings,
  TeamMatchRolesData,
} from "../../store/types";
import type { MyClubView, SquadPlayerView } from "../api";
import type { PlayStyle } from "../api/domain";
import type { ClubSetup } from "../api/rules";

/** The club's setup as the tactics board reads a club (E6-19, C-2 C2-6). */
export function toBoardTeam(club: MyClubView): TacticsBoardTeam {
  const { setup } = club;
  return {
    id: club.club.id,
    formation: setup.formation,
    play_style: setup.playStyle,
    starting_xi_ids: setup.startingXiIds,
    match_roles: setup.matchRoles,
    tactics_phase: setup.tacticsPhase,
    player_roles: setup.playerRoles,
  };
}

/**
 * A player of the coach's own club as the tactics board reads him. The online squad tells his
 * age, not his date of birth, and has no traits or photo.
 */
export function toRosterPlayer(player: SquadPlayerView, clubId: string): TacticsRosterPlayer {
  return {
    id: player.id,
    match_name: player.matchName,
    full_name: player.fullName,
    nationality: player.nationality,
    position: player.position,
    natural_position: player.naturalPosition,
    alternate_positions: player.alternatePositions,
    attributes: player.attributes,
    condition: player.condition,
    morale: player.morale,
    injury: player.injury
      ? { name: player.injury.name, days_remaining: player.injury.daysRemaining }
      : null,
    team_id: clubId,
    ovr: player.ovr,
    jersey_number: player.shirtNumber ?? null,
    age: player.age,
  };
}

/** Each player's rating at every pitch position, by the rule the server picks lineups with. */
export function toPositionRatings(players: SquadPlayerView[]): Record<string, PositionRating[]> {
  return Object.fromEntries(
    players.map((player) => [
      player.id,
      player.positionRatings.map((rating) => ({
        position: rating.position,
        ovr: rating.ovr,
        fit: rating.fit,
      })),
    ]),
  );
}

const PLAY_STYLES: readonly PlayStyle[] = [
  "Balanced",
  "Attacking",
  "Defensive",
  "Possession",
  "Counter",
  "HighPress",
];

/** One change the tactics board asks for, applied to the setup the server last confirmed. */
export type SetupChange =
  | { kind: "startingXi"; playerIds: string[] }
  | { kind: "formation"; formation: string }
  | { kind: "playStyle"; playStyle: string }
  | { kind: "matchRoles"; roles: TeamMatchRolesData }
  | { kind: "tacticsPhase"; patch: Partial<TacticsPhaseSettings> }
  | { kind: "playerRole"; playerId: string; role: PlayerRole };

/**
 * `setup` with `change` applied. The server checks the result and drops a role a player can no
 * longer play where he stands, as the game does (`ofm_rules::setup::apply_setup`), so nothing of
 * that rule is repeated here. An unknown play style is refused before it is sent.
 */
export function applySetupChange(setup: ClubSetup, change: SetupChange): ClubSetup {
  switch (change.kind) {
    case "startingXi":
      return { ...setup, startingXiIds: change.playerIds };
    case "formation":
      return { ...setup, formation: change.formation };
    case "playStyle": {
      const playStyle = PLAY_STYLES.find((style) => style === change.playStyle);
      if (!playStyle) throw new Error(`unknown play style ${change.playStyle}`);
      return { ...setup, playStyle };
    }
    case "matchRoles":
      return { ...setup, matchRoles: change.roles };
    case "tacticsPhase":
      return { ...setup, tacticsPhase: { ...setup.tacticsPhase, ...change.patch } };
    case "playerRole":
      return { ...setup, playerRoles: { ...setup.playerRoles, [change.playerId]: change.role } };
  }
}
