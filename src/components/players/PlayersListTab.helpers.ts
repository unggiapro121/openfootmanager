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
 * Leagues for the players table's league filter, one group per region. A
 * league is labelled with its country, since names like "Premier League"
 * repeat across nations. Clubs in no league offer no league to pick.
 */
export function buildLeagueFilterGroups(tree: DirectoryRegion[]): FilterOptionGroup[] {
  return tree
    .map((region) => ({
      id: region.id,
      label: region.name,
      options: region.countries.flatMap((country) =>
        country.leagues
          .filter((league) => league.id !== UNGROUPED_LEAGUE_ID)
          .map((league) => ({
            id: league.id,
            name: leagueLabel(league, country),
          })),
      ),
    }))
    .filter((group) => group.options.length > 0);
}

/**
 * Clubs for the team filter, one group per league with clubs in name order.
 * With a league chosen only its clubs are offered; otherwise every club is,
 * with clubs in no league last.
 */
export function buildTeamFilterGroups(
  tree: DirectoryRegion[],
  leagueId: string | null,
): FilterOptionGroup[] {
  const leagues = tree.flatMap((region) =>
    region.countries.flatMap((country) =>
      country.leagues.map((league) => ({ league, label: leagueLabel(league, country) })),
    ),
  );
  const isUngrouped = ({ league }: (typeof leagues)[number]) => league.id === UNGROUPED_LEAGUE_ID;
  const chosen = leagueId
    ? leagues.filter(({ league }) => league.id === leagueId)
    : [...leagues.filter((entry) => !isUngrouped(entry)), ...leagues.filter(isUngrouped)];

  return chosen.map(({ league, label }) => ({
    id: league.id,
    label,
    options: league.teams
      .map((card) => ({ id: card.team.id, name: card.team.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
