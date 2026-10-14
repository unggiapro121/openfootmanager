import { UNGROUPED_LEAGUE_ID } from "../../services/teamsService";
import {
  type DirectoryCountry,
  type DirectoryLeague,
  type DirectoryRegion,
  NO_COUNTRY,
} from "../teams/TeamsListTab.helpers";

export interface FilterOption {
  id: string;
  name: string;
}

export interface FilterOptionGroup {
  id: string;
  label: string;
  options: FilterOption[];
}

/** A league's name with its country, since names like "Premier League" repeat across nations. */
function leagueLabel(league: DirectoryLeague, country: DirectoryCountry): string {
  return country.id === NO_COUNTRY ? league.name : `${league.name} (${country.name})`;
}

/**
 * Clubs for the team filter, one group per league with clubs in name order and
 * clubs in no league last. With a competition scope (the filter panel's region,
 * country or league, resolved to its clubs) only those clubs are offered.
 */
export function buildTeamFilterGroups(
  tree: DirectoryRegion[],
  scopeTeamIds: Set<string> | null,
): FilterOptionGroup[] {
  const leagues = tree.flatMap((region) =>
    region.countries.flatMap((country) =>
      country.leagues.map((league) => ({ league, label: leagueLabel(league, country) })),
    ),
  );
  const isUngrouped = ({ league }: (typeof leagues)[number]) => league.id === UNGROUPED_LEAGUE_ID;
  const ordered = [
    ...leagues.filter((entry) => !isUngrouped(entry)),
    ...leagues.filter(isUngrouped),
  ];

  return ordered
    .map(({ league, label }) => ({
      id: league.id,
      label,
      options: league.teams
        .filter((card) => !scopeTeamIds || scopeTeamIds.has(card.team.id))
        .map((card) => ({ id: card.team.id, name: card.team.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.options.length > 0);
}
