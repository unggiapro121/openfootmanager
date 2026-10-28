import type { LeagueView, StandingRow } from "../api";

/** The line of `clubId` in `league`'s table, or null when the club is not in it. */
export function standingOf(league: LeagueView, clubId: string): StandingRow | null {
  return league.table.find((row) => row.club.id === clubId) ?? null;
}
