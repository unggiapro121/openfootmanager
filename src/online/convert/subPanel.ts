import type { EnginePlayerData, EngineTeamData, MatchSnapshot } from "../../components/match/types";
import type { MineView, PlayerRoleLine, ProjectedPlayer, SquadPlayerView } from "../api";
import type { Side } from "../api/engine";
import type { LiveSide, OnlineMatchState } from "./matchState";

/**
 * The live match as the game's own substitution panel reads it (the offline `SubPanel`), so the
 * online coach has the very panel the offline one does: the pitch with its bench, the changes, the
 * swap of two players, the roles, the shape and the style.
 *
 * The coach's side has what only the coach knows: each player's condition as the match stands
 * (`/mine`, live), and from their squad his attributes and his rating at each position. The other
 * side has only what the frames show (a name, a position, an overall).
 */

const NO_ATTRIBUTES = {
  pace: 0,
  stamina: 0,
  strength: 0,
  agility: 0,
  passing: 0,
  shooting: 0,
  tackling: 0,
  dribbling: 0,
  defending: 0,
  positioning: 0,
  vision: 0,
  decisions: 0,
  composure: 0,
  aggression: 0,
  teamwork: 0,
  leadership: 0,
  handling: 0,
  reflexes: 0,
  aerial: 0,
  long_passing: 0,
  crossing: 0,
  curve: 0,
  free_kick: 0,
  long_shots: 0,
  first_touch: 0,
  heading: 0,
};

/** A player as the panel reads him: the frames' view, with the coach's own knowledge when it has it. */
function playerOf(
  player: ProjectedPlayer,
  squad: Map<string, SquadPlayerView>,
  lines: Map<string, PlayerRoleLine>,
): EnginePlayerData {
  const own = squad.get(player.id);
  const line = lines.get(player.id);
  return {
    id: player.id,
    name: player.matchName,
    position: player.position,
    ovr: player.ovr,
    // Live from the match; the squad's (as he kicked off) only if the match has not said.
    condition: line?.condition ?? own?.condition ?? 100,
    ...(own ? { ...NO_ATTRIBUTES, ...own.attributes } : NO_ATTRIBUTES),
    traits: [],
    role: line?.role ?? "",
    ...(own ? { position_ratings: own.positionRatings } : {}),
  };
}

function teamOf(
  key: "home" | "away",
  side: LiveSide,
  squad: Map<string, SquadPlayerView>,
  lines: Map<string, PlayerRoleLine>,
): EngineTeamData {
  return {
    id: key,
    name: side.name,
    formation: side.formation,
    play_style: side.playStyle,
    players: side.eleven.map((player) => playerOf(player, squad, lines)),
  };
}

const NO_TAKERS = { free_kick_taker: null, corner_taker: null, penalty_taker: null, captain: null };

/** The substitutions made so far, in the order they were made, from the match's events. */
function substitutionsOf(state: OnlineMatchState): MatchSnapshot["substitutions"] {
  return state.events
    .filter((event) => event.event_type === "Substitution")
    .map((event) => ({
      minute: event.minute,
      side: event.side,
      player_off_id: event.secondary_player_id ?? "",
      player_on_id: event.player_id ?? "",
      came_on_as: null,
    }));
}

/**
 * The substitution panel's snapshot of `state` for the coach of `mine.side`, whose squad is
 * `squad` (the club the coach runs).
 */
export function toSubPanelSnapshot(
  state: OnlineMatchState,
  mine: MineView,
  squad: SquadPlayerView[],
): MatchSnapshot {
  const bySide = (side: Side) => (side === mine.side ? mine : null);
  const known = new Map(squad.map((player) => [player.id, player]));
  const roles = new Map(mine.roles.map((line) => [line.playerId, line]));
  const none = new Map<string, SquadPlayerView>();
  const noRoles = new Map<string, PlayerRoleLine>();
  const home = bySide("Home") !== null;
  const benchOf = (side: LiveSide, own: boolean) =>
    side.bench.map((player) => playerOf(player, own ? known : none, own ? roles : noRoles));
  return {
    phase: state.phase,
    current_minute: state.minute,
    home_score: state.homeScore,
    away_score: state.awayScore,
    possession: state.possession,
    ball_zone: state.ballZone,
    ball_lane: state.ballLane,
    home_team: teamOf("home", state.home, home ? known : none, home ? roles : noRoles),
    away_team: teamOf("away", state.away, home ? none : known, home ? noRoles : roles),
    home_bench: benchOf(state.home, home),
    away_bench: benchOf(state.away, !home),
    home_possession_pct: state.possessionPct.home,
    away_possession_pct: state.possessionPct.away,
    events: state.events,
    home_subs_made: state.home.subsMade,
    away_subs_made: state.away.subsMade,
    max_subs: state.maxSubs,
    home_set_pieces: home ? mine.setPieces : NO_TAKERS,
    away_set_pieces: home ? NO_TAKERS : mine.setPieces,
    substitutions: substitutionsOf(state),
    allows_extra_time: false,
    home_yellows: {},
    away_yellows: {},
    sent_off: state.sentOff,
    injured: Object.keys(state.injuredSince),
  };
}
