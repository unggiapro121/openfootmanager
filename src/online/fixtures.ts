import type { FixtureView } from "./api";

/** Rounds of an online league season: a double round-robin of 14 clubs (ARCHITECTURE §2.2). */
export const LEAGUE_ROUNDS = 26;
/** Fixtures of one round: 14 clubs, two by two. */
const FIXTURES_PER_ROUND = 7;

export function involves(fixture: FixtureView, clubId: string): boolean {
  return fixture.home.id === clubId || fixture.away.id === clubId;
}

/** A settled fixture as `clubId` lived it; null when it is not settled or the club did not play. */
export function outcomeFor(fixture: FixtureView, clubId: string): "W" | "D" | "L" | null {
  if (fixture.status !== "settled" || !involves(fixture, clubId)) return null;
  if (fixture.homeGoals === undefined || fixture.awayGoals === undefined) return null;
  const own = fixture.home.id === clubId ? fixture.homeGoals : fixture.awayGoals;
  const other = fixture.home.id === clubId ? fixture.awayGoals : fixture.homeGoals;
  return own > other ? "W" : own < other ? "L" : "D";
}

/**
 * The round the league is at: the first not yet fully settled, from how many fixtures are done
 * (seven a round), or the last round once all are.
 */
export function currentRound(fixturesDone: number): number {
  return Math.min(LEAGUE_ROUNDS, Math.floor(fixturesDone / FIXTURES_PER_ROUND) + 1);
}
