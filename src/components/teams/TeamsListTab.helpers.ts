import type { TFunction } from "i18next";

import { competitionDisplayName } from "../../lib/competitionName";
import { buildRegionLabel } from "../../lib/teamRegions";
import {
  type TeamCard,
  type TeamsDirectory,
  UNGROUPED_LEAGUE_ID,
} from "../../services/teamsService";

/** The country of clubs that play in no league the world knows a country for. */
const NO_COUNTRY = "__no-country";

export interface DirectoryLeague {
  id: string;
  name: string;
  teams: TeamCard[];
}

export interface DirectoryCountry {
  id: string;
  name: string;
  leagues: DirectoryLeague[];
}

export interface DirectoryRegion {
  id: string;
  name: string;
  countries: DirectoryCountry[];
}

export interface DirectorySelection {
  regionId: string;
  countryId: string;
  leagueId: string;
}

function countryName(countryId: string, t: TFunction): string {
  if (countryId === NO_COUNTRY) return t("teams.otherClubs");
  return t(`nations.${countryId.toLowerCase()}`, { defaultValue: countryId });
}

/**
 * The directory as region → country → league → clubs, regions and countries in
 * name order, a country's leagues in the order the backend ranks them.
 */
export function buildDirectoryTree(directory: TeamsDirectory, t: TFunction): DirectoryRegion[] {
  return directory.regions
    .map((region) => {
      const countries = new Map<string, DirectoryCountry>();
      for (const league of region.leagues) {
        const countryId = league.country_id ?? NO_COUNTRY;
        const country = countries.get(countryId) ?? {
          id: countryId,
          name: countryName(countryId, t),
          leagues: [],
        };
        country.leagues.push({
          id: league.id,
          name:
            league.id === UNGROUPED_LEAGUE_ID
              ? t("teams.otherClubs")
              : competitionDisplayName(league, t),
          teams: league.teams,
        });
        countries.set(countryId, country);
      }
      return {
        id: region.id,
        name: buildRegionLabel(t, region.id),
        countries: [...countries.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Where a club plays in the tree, or null when it is not there. */
export function locateTeam(
  tree: DirectoryRegion[],
  teamId: string | null,
): DirectorySelection | null {
  if (!teamId) return null;
  for (const region of tree) {
    for (const country of region.countries) {
      for (const league of country.leagues) {
        if (league.teams.some((card) => card.team.id === teamId)) {
          return { regionId: region.id, countryId: country.id, leagueId: league.id };
        }
      }
    }
  }
  return null;
}

/**
 * The selection made valid against the tree: each level keeps what was picked
 * when the level above has it, and otherwise falls back to its first entry, so
 * changing the region or country always lands on a league to show.
 */
export function resolveSelection(
  tree: DirectoryRegion[],
  wanted: Partial<DirectorySelection> | null,
): DirectorySelection | null {
  const region = tree.find((candidate) => candidate.id === wanted?.regionId) ?? tree[0];
  if (!region) return null;
  const country =
    region.countries.find((candidate) => candidate.id === wanted?.countryId) ?? region.countries[0];
  if (!country) return null;
  const league =
    country.leagues.find((candidate) => candidate.id === wanted?.leagueId) ?? country.leagues[0];
  if (!league) return null;
  return { regionId: region.id, countryId: country.id, leagueId: league.id };
}
