import type {
  FixtureDetailData,
  FixturePlayerStatsData,
  FixtureTeamStatsData,
} from "../../services/matchDetailService";
import { competitionDisplayName, type NamedCompetition } from "../../lib/competitionName";
import { nationalTeamDisplayName } from "../../lib/nationalTeams";
import type { CompactLineupData, CompactMatchEventData } from "../../store/types";

export type Side = "home" | "away";
export type NameOf = (playerId: string | null | undefined) => string | null;
type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Resolves a player id to the name the fixture's detail carries, or null. */
export function playerNameOf(detail: FixtureDetailData): NameOf {
  const names = new Map(detail.players.map((player) => [player.id, player.name]));
  return (playerId) => (playerId ? (names.get(playerId) ?? null) : null);
}

/** One key event as a line of text: the player, and who assisted or went off. */
export function eventLabel(event: CompactMatchEventData, nameOf: NameOf, t: Translate): string {
  const name = (playerId: string | null) => nameOf(playerId) ?? t("common.unknown");
  const primary = name(event.player_id);
  switch (event.event_type) {
    case "Goal":
      return event.secondary_player_id
        ? `${primary} (${t("match.assist", { name: name(event.secondary_player_id) })})`
        : primary;
    case "PenaltyGoal":
    case "PenaltyMiss":
      return `${primary} (${t(`match.eventTypes.${event.event_type}`)})`;
    case "Substitution":
      return `${primary} ${t("match.subFor", { name: name(event.secondary_player_id) })}`;
    default:
      return primary;
  }
}

/** The parts of the world that carry the translatable names. */
export interface NamedWorld {
  competitions?: (NamedCompetition & { id: string })[];
  national_teams?: { id: string; name: string; name_key?: string | null }[];
}

/**
 * The detail with its competition and national-team names in the player's
 * language. The backend sends stored names; templated ones ("{{country}} First
 * Division", a nation's team) only read right once translated here, the same
 * way every other screen resolves them.
 */
export function localizeDetailNames(
  detail: FixtureDetailData,
  world: NamedWorld | null,
  t: Translate,
): FixtureDetailData {
  const competition = world?.competitions?.find((comp) => comp.id === detail.competitionId);
  const sideName = (teamId: string, storedName: string) => {
    const nation = world?.national_teams?.find((team) => team.id === teamId);
    return nation ? nationalTeamDisplayName(nation.name_key, storedName, t) : storedName;
  };
  return {
    ...detail,
    competitionName: competition
      ? competitionDisplayName(competition, t) || detail.competitionName
      : detail.competitionName,
    homeTeamName: sideName(detail.homeTeamId, detail.homeTeamName),
    awayTeamName: sideName(detail.awayTeamId, detail.awayTeamName),
  };
}

export function lineupFor(detail: FixtureDetailData, side: Side): CompactLineupData | null {
  const report = detail.result?.report;
  return (side === "home" ? report?.home_lineup : report?.away_lineup) ?? null;
}

export function teamStatsFor(
  detail: FixtureDetailData,
  side: Side,
): FixtureTeamStatsData | undefined {
  const teamId = side === "home" ? detail.homeTeamId : detail.awayTeamId;
  return detail.teamStats.find((row) => row.teamId === teamId);
}

export interface PlayerLine extends FixturePlayerStatsData {
  name: string | null;
  /** The formation slot he started in, or his natural position if he came on. */
  position: string;
  started: boolean;
}

/**
 * A side's players for the ratings table: the starters in formation-slot order,
 * then the substitutes who played. Without a lineup (a match from before they
 * were recorded) the order is by minutes played.
 */
export function playerLinesForSide(detail: FixtureDetailData, side: Side): PlayerLine[] {
  const teamId = side === "home" ? detail.homeTeamId : detail.awayTeamId;
  const nameOf = playerNameOf(detail);
  const naturalPosition = new Map(detail.players.map((player) => [player.id, player.position]));
  const rows = detail.playerStats.filter((row) => row.teamId === teamId);
  const lineup = lineupFor(detail, side);
  const slotOf = new Map(
    (lineup?.starters ?? []).map((slot, index) => [slot.player_id, { index, ...slot }]),
  );

  return rows
    .map((row) => {
      const slot = slotOf.get(row.playerId);
      return {
        ...row,
        name: nameOf(row.playerId),
        position: slot?.position ?? naturalPosition.get(row.playerId) ?? "",
        started: slot !== undefined,
        order: slot?.index ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.order - b.order || b.minutesPlayed - a.minutesPlayed)
    .map(({ order: _order, ...line }) => line);
}

/** The best-rated player who played, from either side; null without ratings. */
export function manOfTheMatchId(detail: FixtureDetailData): string | null {
  let best: FixturePlayerStatsData | null = null;
  for (const row of detail.playerStats) {
    if (row.minutesPlayed > 0 && (best === null || row.rating > best.rating)) {
      best = row;
    }
  }
  return best?.playerId ?? null;
}
