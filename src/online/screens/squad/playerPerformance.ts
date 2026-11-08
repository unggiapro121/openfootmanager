import type { CareerEntry, PlayerSeasonStats } from "../../../store/types";
import type { PlayerAdvancedStatsSummary } from "../../../components/playerProfile/PlayerProfile.helpers";
import type { PlayerRecentMatchEntry } from "../../../components/playerProfile/PlayerProfileRecentMatchesCard";
import type { PlayerMatchView, PlayerPerformanceView, SquadPlayerView } from "../../api";

/**
 * The online player's numbers in the shapes the offline profile's cards read (C-21). A server
 * older than S-43 sends only appearances, goals, assists and the average rating, so every other
 * number may be missing and reads as 0.
 */
const count = (value: number | undefined): number => (typeof value === "number" ? value : 0);

/** His season as the offline season card reads it. */
export function seasonStatsOf(season: SquadPlayerView["season"]): PlayerSeasonStats {
  return {
    appearances: count(season.appearances),
    goals: count(season.goals),
    assists: count(season.assists),
    clean_sheets: count(season.cleanSheets),
    yellow_cards: count(season.yellowCards),
    red_cards: count(season.redCards),
    avg_rating: count(season.avgRating),
    minutes_played: count(season.minutesPlayed),
    shots: count(season.shots),
    shots_on_target: count(season.shotsOnTarget),
    passes_completed: count(season.passesCompleted),
    passes_attempted: count(season.passesAttempted),
    tackles_won: count(season.tacklesWon),
    interceptions: count(season.interceptions),
    fouls_committed: count(season.foulsCommitted),
  };
}

/** His recent form in tenths of a point, when the server sends it. */
export function matchFormOf(player: SquadPlayerView): number | undefined {
  return typeof player.matchForm === "number" ? player.matchForm : undefined;
}

/** His finished seasons as the offline career card reads them. */
export function careerOf(player: SquadPlayerView): CareerEntry[] {
  return (player.career ?? []).map((entry) => ({
    season: entry.season,
    team_id: entry.clubId,
    team_name: entry.clubName,
    appearances: entry.appearances,
    goals: entry.goals,
    assists: entry.assists,
  }));
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const per90 = (total: number, minutes: number): number | null =>
  minutes > 0 ? round1((total * 90) / minutes) : null;

/**
 * His advanced figures from his season alone, without ranks: what the card shows until the
 * server's ranked figures arrive, or when it cannot send them.
 */
export function unrankedAdvanced(season: SquadPlayerView["season"]): PlayerAdvancedStatsSummary {
  const stats = seasonStatsOf(season);
  const minutes = stats.minutes_played;
  const metric = (total: number) => ({ total, per90: per90(total, minutes), percentile: null });
  const completed = stats.passes_completed ?? 0;
  const attempted = stats.passes_attempted ?? 0;
  return {
    percentileEligible: false,
    metrics: {
      shots: metric(stats.shots ?? 0),
      shotsOnTarget: metric(stats.shots_on_target ?? 0),
      passes: {
        completed,
        attempted,
        accuracy: attempted > 0 ? round1((completed / attempted) * 100) : null,
        percentile: null,
      },
      tacklesWon: metric(stats.tackles_won ?? 0),
      interceptions: metric(stats.interceptions ?? 0),
      foulsCommitted: metric(stats.fouls_committed ?? 0),
    },
  };
}

/** The server's ranked figures in the offline card's shape: the same fields, by design (S43-5). */
export function advancedOf(view: PlayerPerformanceView["advanced"]): PlayerAdvancedStatsSummary {
  const metric = (one: { total: number; per90: number | null; percentile: number | null }) => ({
    total: one.total,
    per90: one.per90,
    percentile: one.percentile,
  });
  return {
    percentileEligible: view.percentileEligible,
    metrics: {
      shots: metric(view.metrics.shots),
      shotsOnTarget: metric(view.metrics.shotsOnTarget),
      passes: { ...view.metrics.passes },
      tacklesWon: metric(view.metrics.tacklesWon),
      interceptions: metric(view.metrics.interceptions),
      foulsCommitted: metric(view.metrics.foulsCommitted),
    },
  };
}

/** His matches as the offline recent-matches card reads them, dated by kick-off in `locale`. */
export function recentMatchesOf(
  matches: PlayerMatchView[],
  locale: string,
): PlayerRecentMatchEntry[] {
  const day = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" });
  return matches.map((match) => ({
    fixture_id: match.fixtureId,
    date: day.format(new Date(match.kickoffAt)),
    competition: "League",
    matchday: match.round,
    opponent_team_id: match.opponentClubId,
    opponent_name: match.opponentName,
    team_goals: match.teamGoals,
    opponent_goals: match.opponentGoals,
    minutes_played: match.minutes,
    goals: match.goals,
    assists: match.assists,
    shots: match.shots,
    shots_on_target: match.shotsOnTarget,
    rating: match.rating,
  }));
}
