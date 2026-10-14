import type { TransferAvailabilityFilter, TransferTabView } from "./TransfersTab.model";

// Kept apart from TransfersTab.model so the dashboard can hold the filters
// without pulling the lazily loaded tab's model into the main bundle.

/**
 * How the manager has narrowed the transfer market. Held above the tab by the
 * dashboard: opening a player's profile unmounts the tab, and a search that is
 * gone on the way back means building it again for every player compared.
 */
export interface TransferMarketFilters {
  view: TransferTabView;
  availabilityFilter: TransferAvailabilityFilter;
  search: string;
  /** Position group of the filter panel ("Defender"…), or any. */
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
  affordableOnly: boolean;
  ovrSortDir: "none" | "desc" | "asc";
  marketPage: number;
}

export const DEFAULT_TRANSFER_MARKET_FILTERS: TransferMarketFilters = {
  view: "players",
  availabilityFilter: "all",
  search: "",
  positionGroup: null,
  position: null,
  ageMin: null,
  ageMax: null,
  ovrMin: null,
  ovrMax: null,
  regionId: null,
  countryId: null,
  leagueId: null,
  affordableOnly: false,
  ovrSortDir: "none",
  marketPage: 1,
};

/**
 * Set one filter, by value or from its previous value, without touching the
 * rest. A field-level updater rather than a whole-object one so handlers that
 * set two fields in a row (reset the page, then change the positions) compose.
 */
export function updateTransferMarketFilter<K extends keyof TransferMarketFilters>(
  filters: TransferMarketFilters,
  key: K,
  value:
    | TransferMarketFilters[K]
    | ((previous: TransferMarketFilters[K]) => TransferMarketFilters[K]),
): TransferMarketFilters {
  const next =
    typeof value === "function"
      ? (value as (previous: TransferMarketFilters[K]) => TransferMarketFilters[K])(filters[key])
      : value;
  return { ...filters, [key]: next };
}

/** The fields the filter panel sets, cleared together by its reset. */
export const MARKET_PANEL_DEFAULTS: Pick<
  TransferMarketFilters,
  | "positionGroup"
  | "position"
  | "ageMin"
  | "ageMax"
  | "ovrMin"
  | "ovrMax"
  | "regionId"
  | "countryId"
  | "leagueId"
> = {
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

/**
 * How many of the panel's filters are on, for the badge on its button: the age
 * range, the OVR range, the position and the competition each count once.
 */
export function countActiveMarketFilters(filters: TransferMarketFilters): number {
  return [
    filters.ageMin !== null || filters.ageMax !== null,
    filters.ovrMin !== null || filters.ovrMax !== null,
    filters.positionGroup !== null,
    filters.regionId !== null,
  ].filter(Boolean).length;
}
