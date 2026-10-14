import type { DirectoryRegion } from "../teams/TeamsListTab.helpers";

/**
 * What the player filter panel narrows by. Shared by every screen that lists
 * players: the transfer market filters its list here, the players screen sends
 * the same values to the backend's paged query.
 */
export interface PlayerFilterValues {
  /** Position group ("Defender"…), or any. */
  positionGroup: string | null;
  /** One position within `positionGroup` ("LeftBack"…), or the whole group. */
  position: string | null;
  /** Inclusive age range on the game date; null is open on that side. */
  ageMin: number | null;
  ageMax: number | null;
  /** Inclusive OVR range; null is open on that side. */
  ovrMin: number | null;
  ovrMax: number | null;
  /** Competition scope, narrowing in turn: region, then country, then league. */
  regionId: string | null;
  countryId: string | null;
  leagueId: string | null;
}

export const PLAYER_FILTER_DEFAULTS: PlayerFilterValues = {
  positionGroup: null,
  position: null,
  ageMin: null,
  ageMax: null,
  ovrMin: null,
  ovrMax: null,
  regionId: null,
  countryId: null,
  leagueId: null,
};

/** The position groups of the first position dropdown, in pitch order. */
export const POSITION_GROUPS = ["Goalkeeper", "Defender", "Midfielder", "Forward"] as const;

/** The exact positions each group refines into: the second position dropdown. */
export const SPECIFIC_POSITIONS_BY_GROUP: Record<string, string[]> = {
  Goalkeeper: ["Goalkeeper"],
  Defender: ["CenterBack", "LeftBack", "RightBack", "LeftWingBack", "RightWingBack"],
  Midfielder: [
    "DefensiveMidfielder",
    "CentralMidfielder",
    "AttackingMidfielder",
    "LeftMidfielder",
    "RightMidfielder",
  ],
  Forward: ["LeftWinger", "RightWinger", "Striker"],
};

/**
 * How many filters are on, for the badge on the panel's button: the age range,
 * the OVR range, the position and the competition each count once.
 */
export function countActivePlayerFilters(values: PlayerFilterValues): number {
  return [
    values.ageMin !== null || values.ageMax !== null,
    values.ovrMin !== null || values.ovrMax !== null,
    values.positionGroup !== null,
    values.regionId !== null,
  ].filter(Boolean).length;
}

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
