import type { TFunction } from "i18next";
import type { FixtureData, LeagueData } from "../../store/gameStore";

export function isKnockoutCompetition(competition: LeagueData): boolean {
  return (
    (competition.rules != null && competition.rules.format !== "LeagueTable") ||
    (competition.knockout_rounds?.length ?? 0) > 0
  );
}

export function byTablePosition(
  a: { points: number; goals_for: number; goals_against: number },
  b: { points: number; goals_for: number; goals_against: number },
): number {
  return (
    b.points - a.points ||
    b.goals_for - b.goals_against - (a.goals_for - a.goals_against) ||
    b.goals_for - a.goals_for
  );
}

/** Round names arrive as backend data ("Final", "Round of 16"); localize the known shapes. */
export function localizedRoundName(t: TFunction, name: string): string {
  if (name === "Final") return t("tournaments.rounds.final");
  if (name === "Semifinal") return t("tournaments.rounds.semifinal");
  if (name === "Quarterfinal") return t("tournaments.rounds.quarterfinal");
  const roundOf = name.match(/^Round of (\d+)$/);
  if (roundOf) return t("tournaments.rounds.roundOf", { size: roundOf[1] });
  return name;
}

export interface CompetitionProgress {
  /** Fixtures grouped by matchday, in playing order. */
  sortedMatchdays: Array<[number, FixtureData[]]>;
  completedMatchdays: number;
  totalMatchdays: number;
  /**
   * Awards only become final once the competition's season has fully played
   * out; before that the standings-based winners are just current leaders.
   */
  seasonComplete: boolean;
  totalGoals: number;
  completedMatches: number;
}

export function summarizeCompetitionProgress(
  competitiveFixtures: FixtureData[],
): CompetitionProgress {
  const matchdays = new Map<number, FixtureData[]>();
  competitiveFixtures.forEach((fixture) => {
    const list = matchdays.get(fixture.matchday) || [];
    list.push(fixture);
    matchdays.set(fixture.matchday, list);
  });

  const sortedMatchdays = Array.from(matchdays.entries()).sort((a, b) => a[0] - b[0]);
  const completedMatchdays = sortedMatchdays.filter(([, fixtures]) =>
    fixtures.every((fixture) => fixture.status === "Completed"),
  ).length;
  const totalMatchdays = sortedMatchdays.length;

  return {
    sortedMatchdays,
    completedMatchdays,
    totalMatchdays,
    seasonComplete: totalMatchdays > 0 && completedMatchdays >= totalMatchdays,
    totalGoals: competitiveFixtures
      .filter((fixture) => fixture.result)
      .reduce((sum, fixture) => sum + (fixture.result!.home_goals + fixture.result!.away_goals), 0),
    completedMatches: competitiveFixtures.filter((fixture) => fixture.status === "Completed")
      .length,
  };
}
