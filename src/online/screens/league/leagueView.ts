import { involves, outcomeFor } from "../../fixtures";
import type { FixtureView, LeaderView } from "../../api";

export type Outcome = "W" | "D" | "L";

/**
 * Each club's results over `rounds` (oldest round first), oldest result first: the league's
 * form column. A round a club did not play, or a fixture not settled, adds nothing.
 */
export function recentForm(rounds: readonly FixtureView[][]): Map<string, Outcome[]> {
  const form = new Map<string, Outcome[]>();
  for (const fixtures of rounds) {
    for (const fixture of fixtures) {
      for (const club of [fixture.home, fixture.away]) {
        const outcome = outcomeFor(fixture, club.id);
        if (outcome) form.set(club.id, [...(form.get(club.id) ?? []), outcome]);
      }
    }
  }
  return form;
}

/** A leaderboard line with its rank: players level share one (1, 1, 3). */
export interface RankedLeader extends LeaderView {
  rank: number;
}

export function rankLeaders(leaders: readonly LeaderView[]): RankedLeader[] {
  const ranked: RankedLeader[] = [];
  leaders.forEach((leader, index) => {
    const before = ranked[index - 1];
    const rank = before && before.value === leader.value ? before.rank : index + 1;
    ranked.push({ ...leader, rank });
  });
  return ranked;
}

/** How many others share the first line's value. */
export function tiedWithFirst(leaders: readonly RankedLeader[]): number {
  const first = leaders[0];
  return first ? leaders.filter((leader) => leader.value === first.value).length - 1 : 0;
}

/** A round as the coach reads it: over, being played, or still to come. */
export type RoundState = "done" | "live" | "upcoming";

export function roundState(fixtures: readonly FixtureView[]): RoundState {
  if (fixtures.some((fixture) => fixture.matchStatus === "live")) return "live";
  const over = fixtures.every((one) => one.status === "settled" || one.status === "void");
  return fixtures.length > 0 && over ? "done" : "upcoming";
}

/** The round's fixtures, the coach's own first, the rest as the server listed them. */
export function ownFirst(fixtures: readonly FixtureView[], clubId: string | null): FixtureView[] {
  if (!clubId) return [...fixtures];
  return [
    ...fixtures.filter((fixture) => involves(fixture, clubId)),
    ...fixtures.filter((fixture) => !involves(fixture, clubId)),
  ];
}
