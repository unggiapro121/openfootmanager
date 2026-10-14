import { calcAgeOnDate } from "../../lib/valueFormatting";
import { canonicalPosition } from "../../lib/positions";
import { getPlayerOvr } from "../../lib/playerOvr";
import type { PlayerData } from "../../store/gameStore";
import type { DirectoryRegion } from "../teams/TeamsListTab.helpers";
import type { TransferMarketFilters } from "./TransfersTab.filters";
import { SPECIFIC_POSITIONS_BY_GROUP } from "./TransfersTab.model";

/**
 * The positions the two position dropdowns stand for: the one chosen, or every
 * position of the chosen group, or none at all (any position).
 */
export function positionsForFilter(group: string | null, position: string | null): string[] {
  if (position) return [position];
  if (group) return SPECIFIC_POSITIONS_BY_GROUP[group] ?? [];
  return [];
}

/**
 * The clubs of the chosen competition scope, narrowing from region to country
 * to league; null when no scope is chosen, which restricts nothing.
 */
export function teamIdsInScope(
  tree: DirectoryRegion[],
  regionId: string | null,
  countryId: string | null,
  leagueId: string | null,
): Set<string> | null {
  if (!regionId) return null;
  const ids = new Set<string>();
  for (const region of tree) {
    if (region.id !== regionId) continue;
    for (const country of region.countries) {
      if (countryId && country.id !== countryId) continue;
      for (const league of country.leagues) {
        if (leagueId && league.id !== leagueId) continue;
        for (const card of league.teams) ids.add(card.team.id);
      }
    }
  }
  return ids;
}

const inRange = (value: number, min: number | null, max: number | null) =>
  (min === null || value >= min) && (max === null || value <= max);

/**
 * The players the filter panel lets through: age on `currentDate` and OVR inside
 * their ranges, of the chosen position, and at a club of `scopeTeamIds` when a
 * competition is chosen. A free agent has no club, so a competition excludes him.
 */
export function applyMarketPanelFilters(
  players: PlayerData[],
  filters: TransferMarketFilters,
  currentDate: string,
  scopeTeamIds: Set<string> | null,
): PlayerData[] {
  const positions = new Set(positionsForFilter(filters.positionGroup, filters.position));
  return players.filter((player) => {
    if (positions.size > 0) {
      const position = canonicalPosition(player.natural_position || player.position);
      if (!positions.has(position)) return false;
    }
    if (scopeTeamIds && !(player.team_id && scopeTeamIds.has(player.team_id))) return false;
    if (!inRange(getPlayerOvr(player), filters.ovrMin, filters.ovrMax)) return false;
    if (filters.ageMin !== null || filters.ageMax !== null) {
      const age = calcAgeOnDate(player.date_of_birth, currentDate);
      if (!inRange(age, filters.ageMin, filters.ageMax)) return false;
    }
    return true;
  });
}
