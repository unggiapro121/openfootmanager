import type { TournamentsTeamLookup } from "../../components/tournaments/teamLookup";
import type { StandingData } from "../../store/types";
import type { LeagueView, StandingRow } from "../api";

/** An online table's rows as the game's standings table reads them, in the server's order. */
export function toStandingData(rows: StandingRow[]): StandingData[] {
  return [...rows]
    .sort((left, right) => left.position - right.position)
    .map((row) => ({
      team_id: row.club.id,
      played: row.played,
      won: row.won,
      drawn: row.drawn,
      lost: row.lost,
      goals_for: row.goalsFor,
      goals_against: row.goalsAgainst,
      points: row.points,
    }));
}

/** How the standings table names an online league's clubs and opens one of them. */
export function leagueTeamLookup(
  league: LeagueView,
  myClubId: string | null,
  openClub: (clubId: string) => void,
): TournamentsTeamLookup {
  const names = new Map(league.table.map((row) => [row.club.id, row.club.name]));
  return {
    userTeamId: myClubId,
    isClubTeam: (id) => names.has(id),
    resolveTeamName: (id) => names.get(id) ?? id,
    onSelectTeam: openClub,
  };
}
