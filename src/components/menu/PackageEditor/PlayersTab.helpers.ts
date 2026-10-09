import { CORE_POSITIONS, normalisePosition } from "../../squad/SquadTab.helpers";
import { POSITIONS } from "./helpers";
import type { CompetitionDef, PlayerDef, Position, TeamDef } from "./types";

type CorePosition = (typeof CORE_POSITIONS)[number];

/**
 * What the position dropdown is set to: everything, one of the four broad
 * groups, or one of the seventeen positions a player can actually be given.
 *
 * Groups carry a prefix because four of the seventeen positions are named
 * after them. Choosing "Defenders" should find every full-back and centre
 * half; choosing "Defender" should find only the players a package left on
 * the broad value. Without the prefix those two are the same string.
 */
export type PositionFilter = "All" | `group:${CorePosition}` | Position;

const GROUP_PREFIX = "group:";

export function matchesPositionFilter(position: Position, filter: PositionFilter): boolean {
  if (filter === "All") {
    return true;
  }
  if (filter.startsWith(GROUP_PREFIX)) {
    return normalisePosition(position) === filter.slice(GROUP_PREFIX.length);
  }
  return position === filter;
}

export interface PositionFilterOption {
  value: PositionFilter;
  labelKey: string;
}

export interface PositionFilterGroup {
  labelKey: string;
  options: PositionFilterOption[];
}

/** The dropdown's two sections: the broad groups, then every exact position. */
export function positionFilterGroups(): PositionFilterGroup[] {
  return [
    {
      labelKey: "worldEditor.positionFilterByGroup",
      // Not `common.positionGroups.*`: in German, Chinese and Indonesian its
      // plurals are byte-identical to four of the seventeen exact positions,
      // so the same label would appear in both sections meaning two different
      // things. These are worded "all <group>" instead.
      options: CORE_POSITIONS.map((core) => ({
        value: `${GROUP_PREFIX}${core}` as PositionFilter,
        labelKey: `worldEditor.positionGroupFilter.${core}`,
      })),
    },
    {
      labelKey: "worldEditor.positionFilterBySpecific",
      options: POSITIONS.map((position) => ({
        value: position,
        labelKey: `common.positions.${position}`,
      })),
    },
  ];
}

/**
 * What the club dropdown is set to: everything, players without a club, or one
 * team id. The free-agent value cannot be a team id — ids are slugs.
 */
export type ClubFilter = string;

export const FREE_AGENTS_FILTER = "__free__";

/** The domestic leagues a package defines, the ones the league filter offers. */
export function leagueCompetitions(competitions: CompetitionDef[] | undefined): CompetitionDef[] {
  return (competitions ?? []).filter((c) => c.type === "League" && c.id);
}

/**
 * The clubs a league draws, as far as the package says without running the
 * engine: its explicit list, or every club of the country for an
 * `allInCountry` selector. A `topByReputation` cut needs the engine's
 * reputation roll, so it is approximated by the whole country too — the
 * filter is a way to find players, not a promise of who qualifies.
 */
export function competitionClubIds(
  competition: CompetitionDef,
  teams: TeamDef[] | undefined,
): Set<string> {
  const ids = new Set(competition.participants?.explicit ?? []);
  const selector = competition.participants?.selector;
  const country = selector?.country ?? competition.countryId;
  if (
    selector &&
    country &&
    (selector.kind === "allInCountry" || selector.kind === "topByReputation")
  ) {
    for (const team of teams ?? []) {
      if (team.id && team.country === country) ids.add(team.id);
    }
  }
  return ids;
}

function matchesClubFilter(club: string, filter: ClubFilter): boolean {
  if (filter === "All") return true;
  if (filter === FREE_AGENTS_FILTER) return !club;
  return club === filter;
}

/** A player paired with its index in the unfiltered array. */
export interface IndexedPlayer {
  player: PlayerDef;
  i: number;
}

export interface FilterPlayerRowsParams {
  players: PlayerDef[];
  /** Omit to include every player; set to scope to the youth or senior list. */
  youthOnly?: boolean;
  /** Defaults to "All" so callers that have no dropdown can leave it out. */
  positionFilter?: PositionFilter;
  query: string;
  teamNames: Map<string, string>;
  /** Clubs of the chosen league; null or omitted means every league. */
  leagueClubs?: ReadonlySet<string> | null;
  /** Defaults to "All". */
  clubFilter?: ClubFilter;
}

export interface FilteredPlayerRows {
  /** Everything in scope, before the search box narrows it. */
  scoped: IndexedPlayer[];
  /** What the search box left. */
  filtered: IndexedPlayer[];
}

function displayName(player: PlayerDef): string {
  return player.name || `${player.firstName} ${player.lastName}`;
}

/**
 * Narrow the player list, keeping each player's index in the array it came
 * from. That index is the record's identity everywhere else — edit, delete,
 * duplicate and the selection highlight all address the unfiltered array — so
 * it has to survive filtering rather than be recomputed from the result.
 *
 * Both totals come back because they answer different questions: the empty
 * state asks whether there are any players at all, the row count asks how many
 * the search left.
 */
export function filterPlayerRows({
  players,
  youthOnly,
  positionFilter = "All",
  query,
  teamNames,
  leagueClubs = null,
  clubFilter = "All",
}: FilterPlayerRowsParams): FilteredPlayerRows {
  const scoped: IndexedPlayer[] = [];
  for (let i = 0; i < players.length; i += 1) {
    const player = players[i];
    if (youthOnly !== undefined && Boolean(player.youth) !== youthOnly) {
      continue;
    }
    scoped.push({ player, i });
  }

  // The dropdowns before the search box: one comparison rules a player out
  // where the query needs six.
  const byDropdowns =
    positionFilter === "All" && clubFilter === "All" && !leagueClubs
      ? scoped
      : scoped.filter(
          ({ player }) =>
            matchesPositionFilter(player.position, positionFilter) &&
            matchesClubFilter(player.club, clubFilter) &&
            (!leagueClubs || leagueClubs.has(player.club)),
        );

  const q = query.trim().toLowerCase();
  if (!q) {
    return { scoped, filtered: byDropdowns };
  }

  const filtered = byDropdowns.filter(({ player }) => {
    // Club matches on the name the row displays as well as the stored id —
    // searching for what is on screen finding nothing was its own small bug.
    const clubName = player.club ? teamNames.get(player.club) : undefined;
    return (
      displayName(player).toLowerCase().includes(q) ||
      player.id.toLowerCase().includes(q) ||
      player.club.toLowerCase().includes(q) ||
      clubName?.toLowerCase().includes(q) ||
      player.position.toLowerCase().includes(q) ||
      player.nationality.toLowerCase().includes(q)
    );
  });

  return { scoped, filtered };
}
