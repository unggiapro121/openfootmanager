import type { FixtureView } from "./api";
import { online } from "./client";
import { tracked } from "./store/onlineStore";

/** Rounds of an online league season: a double round-robin of 14 clubs (ARCHITECTURE §2.2). */
export const LEAGUE_ROUNDS = 26;
/** Fixtures of one round: 14 clubs, two by two. */
const FIXTURES_PER_ROUND = 7;
/** Round reads sent at once while a whole season is read. */
const ROUNDS_AT_ONCE = 4;

/**
 * Every fixture of `clubId` in its league's season, by round. Read round by round until the
 * server has a route for a club's season (`GET /v1/clubs/mine/fixtures`, package C-2s).
 */
export async function seasonFixturesOf(leagueId: string, clubId: string): Promise<FixtureView[]> {
  const rounds = Array.from({ length: LEAGUE_ROUNDS }, (_, index) => index + 1);
  const found: FixtureView[] = [];
  for (let start = 0; start < rounds.length; start += ROUNDS_AT_ONCE) {
    const batch = rounds.slice(start, start + ROUNDS_AT_ONCE);
    const views = await Promise.all(
      batch.map((round) => tracked(() => online.leagues.round(leagueId, round))),
    );
    for (const view of views) {
      found.push(...view.fixtures.filter((fixture) => involves(fixture, clubId)));
    }
  }
  return found.sort((left, right) => left.round - right.round);
}

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
