import type { PlayersPageQuery } from "../../services/playersService";
import { PLAYER_FILTER_DEFAULTS, type PlayerFilterValues } from "../playerFilters/playerFilters";

// Kept apart from PlayersListTab so the dashboard can hold the filters without
// pulling the tab into its bundle.

const PAGE_SIZE = 30;

/**
 * How the manager has narrowed the players list. Held above the tab by the
 * dashboard: opening a player's profile unmounts the tab, and a search that is
 * gone on the way back means building it again for every player compared.
 */
export interface PlayersListFilters {
  /** Search, status, club, sort and page, as the backend's paged query reads them. */
  query: PlayersPageQuery;
  /** The filter panel: age, OVR, position and competition scope. */
  panel: PlayerFilterValues;
}

export const DEFAULT_PLAYERS_LIST_FILTERS: PlayersListFilters = {
  query: {
    search: null,
    position: null,
    team_id: null,
    league_id: null,
    team_ids: null,
    positions: [],
    age_min: null,
    age_max: null,
    ovr_min: null,
    ovr_max: null,
    status: "all",
    sort_key: "ovr",
    sort_asc: false,
    page: 1,
    page_size: PAGE_SIZE,
  },
  panel: PLAYER_FILTER_DEFAULTS,
};
