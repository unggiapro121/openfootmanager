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
  specificPositions: string[];
  affordableOnly: boolean;
  ovrSortDir: "none" | "desc" | "asc";
  marketPage: number;
}

export const DEFAULT_TRANSFER_MARKET_FILTERS: TransferMarketFilters = {
  view: "players",
  availabilityFilter: "all",
  search: "",
  specificPositions: [],
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
