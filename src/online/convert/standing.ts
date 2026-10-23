import type { LeagueStandingSnapshot } from "../../components/home/HomeLeaguePositionCard";
import type { LeagueView, StandingRow } from "../api";

/** A club's line of an online table, as the desktop's league-position card reads it (E6-19). */
export function toStandingSnapshot(row: StandingRow): LeagueStandingSnapshot {
  return {
    team_id: row.club.id,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goals_for: row.goalsFor,
    goals_against: row.goalsAgainst,
    points: row.points,
  };
}

/** The line of `clubId` in `league`'s table, or null when the club is not in it. */
export function standingOf(league: LeagueView, clubId: string): StandingRow | null {
  return league.table.find((row) => row.club.id === clubId) ?? null;
}
