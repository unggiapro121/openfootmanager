import { calcAgeOnDate } from "../../lib/valueFormatting";
import { canonicalPosition } from "../../lib/positions";
import { getPlayerOvr } from "../../lib/playerOvr";
import type { PlayerData } from "../../store/gameStore";
import { type PlayerFilterValues, positionsForFilter } from "../playerFilters/playerFilters";

const inRange = (value: number, min: number | null, max: number | null) =>
  (min === null || value >= min) && (max === null || value <= max);

/**
 * The players the filter panel lets through: age on `currentDate` and OVR inside
 * their ranges, of the chosen position, and at a club of `scopeTeamIds` when a
 * competition is chosen. A free agent has no club, so a competition excludes him.
 */
export function applyMarketPanelFilters(
  players: PlayerData[],
  filters: PlayerFilterValues,
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
