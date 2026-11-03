import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SPECIFIC_POSITIONS_BY_GROUP } from "../../../components/playerFilters/playerFilters";
import type { AuctionView, MarketQuery } from "../../api";
import { online } from "../../client";
import type { OnlineApiError } from "../../errors";
import { tracked } from "../../store/onlineStore";
import { BIDDABLE, NUMBER_FILTERS, POSITION_GROUPS } from "./MarketFilterPanel";

/** The open auctions are read again this often while the page is open (C5-6). */
const MARKET_RELOAD_MILLIS = 30_000;
const MARKET_CLOSED = "be.error.auction.marketClosed";
/** The address parameter of the name search. */
const NAME_SEARCH = "q";

/** The filters in the address, as the server's query (C5-6): kept there so going back keeps them. */
function queryOf(params: URLSearchParams): MarketQuery {
  const query: MarketQuery = {};
  const position = params.get("position");
  if (position && (POSITION_GROUPS as readonly string[]).includes(position)) {
    query.position = position;
  }
  const natural = params.get("naturalPosition");
  if (natural && Object.values(SPECIFIC_POSITIONS_BY_GROUP).some((one) => one.includes(natural))) {
    query.naturalPosition = natural;
  }
  for (const name of NUMBER_FILTERS) {
    const value = Number(params.get(name));
    if (params.get(name) && Number.isInteger(value) && value >= 0) query[name] = value;
  }
  if (params.get(BIDDABLE) === "true") query.biddable = true;
  return query;
}

/** The auctions whose player's name holds `search`, as typed. */
export function byName(items: AuctionView[], search: string): AuctionView[] {
  const needle = search.trim().toLowerCase();
  if (needle === "") return items;
  return items.filter((auction) => auction.player?.fullName.toLowerCase().includes(needle));
}

/**
 * The market's filters, kept in the address so going back keeps them: the server's query (as a
 * key that changes only when it does), the name search the loaded page is narrowed by, and the
 * ways to set and clear them.
 */
export function useMarketParams() {
  const [params, setParams] = useSearchParams();
  const queryKey = new URLSearchParams(
    Object.entries(queryOf(params)).map(([name, value]) => [name, String(value)]),
  ).toString();
  const setFilter = (patch: Record<string, string>) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        for (const [name, value] of Object.entries(patch)) {
          if (value === "") copy.delete(name);
          else copy.set(name, value);
        }
        return copy;
      },
      { replace: true },
    );
  const clearFilters = () =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        for (const name of [...NUMBER_FILTERS, "position", "naturalPosition", BIDDABLE]) {
          copy.delete(name);
        }
        return copy;
      },
      { replace: true },
    );
  return {
    params,
    queryKey,
    search: params.get(NAME_SEARCH) ?? "",
    setSearch: (value: string) => setFilter({ [NAME_SEARCH]: value }),
    setFilter,
    clearFilters,
  };
}

export type OpenState =
  | { status: "loading" }
  | { status: "closed" }
  | { status: "failed"; error: unknown }
  | { status: "ready"; items: AuctionView[]; cursor?: string };

/** The open auctions under `queryKey`: read again when it changes, on a market ring, and every 30 s. */
export function useOpenAuctions(queryKey: string, ring: number) {
  const [state, setState] = useState<OpenState>({ status: "loading" });
  const [moreError, setMoreError] = useState<unknown>(null);

  const load = useCallback(() => {
    const query = Object.fromEntries(new URLSearchParams(queryKey)) as Record<string, string>;
    tracked(() => online.market.auctions(query as MarketQuery))
      .then((page) => setState({ status: "ready", items: page.items, cursor: page.nextCursor }))
      .catch((error: OnlineApiError) =>
        setState(error.code === MARKET_CLOSED ? { status: "closed" } : { status: "failed", error }),
      );
  }, [queryKey]);

  useEffect(() => {
    setState({ status: "loading" });
    load();
  }, [load]);
  useEffect(() => {
    if (ring > 0) load();
  }, [ring, load]);
  useEffect(() => {
    const timer = window.setInterval(load, MARKET_RELOAD_MILLIS);
    return () => window.clearInterval(timer);
  }, [load]);

  const more = (cursor: string) => {
    setMoreError(null);
    const query = Object.fromEntries(new URLSearchParams(queryKey)) as MarketQuery;
    tracked(() => online.market.auctions({ ...query, cursor }))
      .then((page) =>
        setState((current) =>
          current.status === "ready"
            ? { status: "ready", items: [...current.items, ...page.items], cursor: page.nextCursor }
            : current,
        ),
      )
      .catch(setMoreError);
  };

  return { state, load, more, moreError };
}
