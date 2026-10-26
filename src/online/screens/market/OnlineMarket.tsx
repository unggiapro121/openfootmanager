import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Filter, Search, TrendingUp } from "lucide-react";
import { TraitList } from "../../../components/TraitBadge";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { translatePositionAbbreviation } from "../../../components/squad/SquadTab.helpers";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CountryFlag,
  PlayerAvatar,
  SortHeader,
} from "../../../components/ui";
import { countryName } from "../../../lib/countries";
import { positionBadgeVariant } from "../../../lib/playerRating";
import { formatVal, formatWeeklyAmount } from "../../../lib/valueFormatting";
import type { AuctionView, MarketQuery, MyMarketView } from "../../api";
import { online } from "../../client";
import type { OnlineApiError } from "../../errors";
import { refreshMarket, tracked, useOnlineStore } from "../../store/onlineStore";
import PotentialStars from "../PotentialStars";
import { avatarOf } from "../squad/playerLook";
import { SPECIFIC_POSITIONS_BY_GROUP } from "../../../components/playerFilters/playerFilters";
import MarketFilterPanel, { NUMBER_FILTERS, POSITION_GROUPS } from "./MarketFilterPanel";
import { marketErrorText } from "./marketText";
import { useServerCountdown, useServerOffset } from "./useServerCountdown";

/** The open auctions are read again this often while the page is open (C5-6). */
const MARKET_RELOAD_MILLIS = 30_000;
const MARKET_CLOSED = "be.error.auction.marketClosed";

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
  return query;
}

/**
 * The auction market (C-5 §3.5, C5-6): the open auctions, filtered by the server and read a page at
 * a time, and the club's own listings, bids and recent results. Opening it clears the sidebar's dot.
 */
export default function OnlineMarket() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "mine" ? "mine" : "open";
  const marketUnseen = useOnlineStore((state) => state.marketUnseen);

  useEffect(() => {
    if (marketUnseen > 0) useOnlineStore.setState({ marketUnseen: 0 });
  }, [marketUnseen]);

  const choose = (next: "open" | "mine") =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (next === "mine") copy.set("tab", "mine");
        else copy.delete("tab");
        return copy;
      },
      { replace: true },
    );

  return (
    <div className="space-y-4">
      <Card accent="primary">
        <div className="rounded-t-xl bg-gradient-to-r from-navy-700 to-navy-800 p-5">
          <h2 className="flex items-center gap-2 font-heading text-lg font-bold uppercase tracking-wide text-white">
            <TrendingUp className="h-5 w-5 text-accent-400" aria-hidden="true" />
            {t("online.market.title")}
          </h2>
          <p className="mt-0.5 text-xs text-gray-400">{t("online.market.openTitle")}</p>
        </div>
      </Card>
      <div role="tablist" aria-label={t("online.market.title")} className="flex flex-wrap gap-2">
        <TabButton selected={tab === "open"} onClick={() => choose("open")}>
          {t("online.market.tabOpen")}
        </TabButton>
        <TabButton selected={tab === "mine"} onClick={() => choose("mine")}>
          {t("online.market.tabMine")}
        </TabButton>
      </div>
      {tab === "open" ? <OpenAuctions ring={marketUnseen} /> : <MyAuctions />}
    </div>
  );
}

function TabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`rounded-lg px-4 py-2 font-heading text-sm font-bold uppercase tracking-wider transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-900 ${
        selected
          ? "bg-primary-700 text-white shadow-md shadow-primary-700/20"
          : "border border-gray-200 bg-white text-gray-500 hover:text-gray-700 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-400 dark:hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

type OpenState =
  | { status: "loading" }
  | { status: "closed" }
  | { status: "failed"; error: unknown }
  | { status: "ready"; items: AuctionView[]; cursor?: string };

/** The open auctions: read again when the filters change, on a market ring, and every 30 s. */
function OpenAuctions({ ring }: { ring: number }) {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const queryKey = new URLSearchParams(
    Object.entries(queryOf(params)).map(([name, value]) => [name, String(value)]),
  ).toString();
  const [state, setState] = useState<OpenState>({ status: "loading" });
  const [moreError, setMoreError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const loaded = state.status === "ready" ? state.items : null;
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!loaded) return [];
    if (needle === "") return loaded;
    return loaded.filter((auction) => auction.player?.fullName.toLowerCase().includes(needle));
  }, [loaded, search]);
  const count = shown.length;

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
        for (const name of [...NUMBER_FILTERS, "position", "naturalPosition"]) copy.delete(name);
        return copy;
      },
      { replace: true },
    );

  return (
    <div className="space-y-4">
      <MarketFilters
        params={params}
        onChange={setFilter}
        onClear={clearFilters}
        count={count}
        onSearch={setSearch}
        search={search}
      />
      {state.status === "loading" && (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>
      )}
      {state.status === "closed" && (
        <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.market.closed")}</p>
      )}
      {state.status === "failed" && (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {marketErrorText(t, i18n.language, state.error)}
          </p>
          <Button variant="outline" size="sm" onClick={load}>
            {t("online.retry")}
          </Button>
        </div>
      )}
      {state.status === "ready" && (
        <>
          <AuctionTable items={shown} />
          {moreError !== null && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {marketErrorText(t, i18n.language, moreError)}
            </p>
          )}
          {state.cursor && (
            <Button variant="outline" size="sm" onClick={() => more(state.cursor as string)}>
              {t("online.market.more")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function MarketFilters({
  params,
  onChange,
  onClear,
  count,
  search,
  onSearch,
}: {
  params: URLSearchParams;
  onChange: (patch: Record<string, string>) => void;
  onClear: () => void;
  count: number;
  search: string;
  onSearch: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[180px] max-w-xs flex-1">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
          aria-hidden="true"
        />
        <input
          type="search"
          aria-label={t("transfers.searchByName")}
          placeholder={t("transfers.searchByName")}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-200 dark:placeholder-gray-500"
        />
      </div>
      <MarketFilterPanel params={params} onChange={onChange} onClear={onClear} />
      <p className="font-heading text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500">
        <Filter className="-mt-0.5 mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
        {t("common.nResults", { count })}
      </p>
    </div>
  );
}

type SortColumn = "age" | "ovr" | "potential" | "wage" | "price" | "time";
type Sort = { column: SortColumn; dir: "asc" | "desc" } | null;

/** What a column orders by; an auction without its player (retired) sorts last. */
function sortValue(auction: AuctionView, column: SortColumn): number {
  switch (column) {
    case "age":
      return auction.player?.age ?? -1;
    case "ovr":
      return auction.player?.ovr ?? -1;
    case "potential":
      return auction.player?.potentialStars ?? -1;
    case "wage":
      return auction.player?.wage ?? -1;
    case "price":
      return auction.currentPrice ?? auction.startPrice;
    case "time":
      return Date.parse(auction.endsAt);
  }
}

const HEAD =
  "px-4 py-3 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400";

type TableMode = "open" | "mine" | "closed";

/** What the club is to an auction, as the badge of its row. */
const STANDING_VARIANT: Record<string, "accent" | "success" | "primary" | "neutral"> = {
  selling: "accent",
  leading: "success",
  bought: "success",
  sold: "primary",
};

/** The auctions as a table. `mine` and `closed` add where the club stands; a closed auction has no
 * time left. */
function AuctionTable({ items, mode = "open" }: { items: AuctionView[]; mode?: TableMode }) {
  const { t } = useTranslation();
  const clubId = useOnlineStore((state) => state.club?.club.id);
  const offset = useServerOffset(items[0]?.serverNow);
  const [sort, setSort] = useState<Sort>(null);
  const sorted = useMemo(() => {
    if (!sort) return items;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...items].sort(
      (a, b) => sign * (sortValue(a, sort.column) - sortValue(b, sort.column)),
    );
  }, [items, sort]);
  const sortBy = (column: SortColumn) =>
    setSort((current) =>
      current?.column === column
        ? current.dir === "desc"
          ? { column, dir: "asc" }
          : null
        : { column, dir: "desc" },
    );
  if (items.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {t(mode === "open" ? "online.market.empty" : "online.market.none")}
          </p>
        </CardBody>
      </Card>
    );
  }
  const header = (column: SortColumn, label: string) => (
    <SortHeader
      col={column}
      label={label}
      sortKey={sort?.column ?? null}
      sortDir={sort?.dir ?? "desc"}
      onSort={sortBy}
      paddingClassName="py-3 px-4"
    />
  );
  return (
    <Card>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs dark:border-navy-600 dark:bg-navy-800">
                <th scope="col" className={HEAD}>
                  {t("common.position")}
                </th>
                <th scope="col" className={HEAD}>
                  {t("common.player")}
                </th>
                {header("age", t("common.age"))}
                {header("ovr", t("common.ovr"))}
                {header("potential", t("online.squad.potential"))}
                <th scope="col" className={HEAD}>
                  {t("squad.traits")}
                </th>
                {header("wage", t("common.wage"))}
                {header("price", t("online.market.price"))}
                <th scope="col" className={HEAD}>
                  {t("online.market.bids")}
                </th>
                {mode !== "closed" && header("time", t("online.market.timeLeft"))}
                <th scope="col" className={HEAD}>
                  {t("online.market.seller")}
                </th>
                {mode !== "open" && (
                  <th scope="col" className={HEAD}>
                    {t("common.status")}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
              {sorted.map((auction) => (
                <AuctionRow
                  key={auction.id}
                  auction={auction}
                  offset={offset}
                  mode={mode}
                  clubId={clubId}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

/** A club the server runs (a bot), marked "AI" beside its name (B7). */
export function ClubName({ name, isBot }: { name: string; isBot: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5">
      {name}
      {isBot && (
        <Badge variant="accent" size="sm">
          <span aria-hidden>{t("online.market.ai")}</span>
          <span className="sr-only">{t("online.market.aiClub")}</span>
        </Badge>
      )}
    </span>
  );
}

/** Who sells an auction's player: a club (marked when the AI runs it), or the world, for a free
 * agent (S-11f). */
export function SellerName({ auction }: { auction: AuctionView }) {
  const { t } = useTranslation();
  if (auction.freeAgent) return <span>{t("online.market.freeAgent")}</span>;
  return <ClubName name={auction.sellerName} isBot={auction.sellerIsBot} />;
}

/** What the coach's own club is to an auction: the seller, the leader, or neither. */
export function OwnLabels({ auction }: { auction: AuctionView }) {
  const { t } = useTranslation();
  const clubId = useOnlineStore((state) => state.club?.club.id);
  return (
    <>
      {auction.sellerClubId === clubId && (
        <Badge variant="neutral">{t("online.market.yourClub")}</Badge>
      )}
      {auction.leaderClubId === clubId && auction.status === "active" && (
        <Badge variant="success">{t("online.market.youLead")}</Badge>
      )}
    </>
  );
}

function AuctionRow({
  auction,
  offset,
  mode,
  clubId,
}: {
  auction: AuctionView;
  offset: number;
  mode: TableMode;
  clubId: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { text } = useServerCountdown(auction.endsAt, offset);
  const player = auction.player;
  const ovr = player?.ovr ?? 0;
  return (
    <tr
      className="group cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-navy-700/50"
      onClick={() => navigate(`/online/auctions/${auction.id}`)}
    >
      <td className="px-4 py-2.5">
        {player ? (
          <Badge variant={positionBadgeVariant(player.naturalPosition)} size="sm">
            {translatePositionAbbreviation(t, player.naturalPosition)}
          </Badge>
        ) : (
          "–"
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-3">
          {player && (
            <PlayerAvatar
              player={avatarOf({
                id: auction.playerId,
                fullName: player.fullName,
                matchName: player.fullName,
                nationality: player.nationality,
                avatarSeed: player.avatarSeed,
              })}
            />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/online/auctions/${auction.id}`}
                onClick={(event) => event.stopPropagation()}
                className="truncate rounded text-sm font-semibold text-gray-800 transition-colors hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-gray-200 dark:hover:text-primary-400 dark:focus:ring-offset-navy-800"
              >
                {player?.fullName ?? t("online.market.retiredPlayer")}
              </Link>
              <OwnLabels auction={auction} />
            </div>
            {player && (
              <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <CountryFlag
                  code={player.nationality}
                  locale={i18n.language}
                  className="text-sm leading-none"
                />
                <span>{countryName(player.nationality, i18n.language)}</span>
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5 text-sm tabular-nums text-gray-600 dark:text-gray-400">
        {player?.age ?? "–"}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`font-heading text-base font-bold tabular-nums ${ovr >= 75 ? "text-primary-500" : ovr >= 55 ? "text-accent-500" : "text-gray-400"}`}
        >
          {player?.ovr ?? "–"}
        </span>
      </td>
      <td className="px-4 py-2.5">{player && <PotentialStars stars={player.potentialStars} />}</td>
      <td className="px-4 py-2.5">
        <div className="min-w-20">
          <TraitList traits={player?.traits ?? []} size="xs" iconOnly />
        </div>
      </td>
      <td className="px-4 py-2.5 text-sm tabular-nums text-gray-600 dark:text-gray-400">
        {player ? formatWeeklyAmount(formatVal(player.wage), t("finances.perWeekSuffix")) : "–"}
      </td>
      <td className="px-4 py-2.5 text-sm font-medium tabular-nums text-gray-700 dark:text-gray-300">
        <PriceText auction={auction} />
      </td>
      <td className="px-4 py-2.5 text-sm tabular-nums text-gray-600 dark:text-gray-400">
        {auction.bidsCount}
      </td>
      {mode !== "closed" && (
        <td className="px-4 py-2.5 text-sm tabular-nums text-gray-600 dark:text-gray-400">
          {text ?? t("online.market.ending")}
        </td>
      )}
      <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400">
        <SellerName auction={auction} />
      </td>
      {mode !== "open" && (
        <td className="px-4 py-2.5">
          <Badge variant={STANDING_VARIANT[standing(auction, clubId)] ?? "neutral"} size="sm">
            {t(`online.market.standing.${standing(auction, clubId)}`)}
          </Badge>
        </td>
      )}
    </tr>
  );
}

/** The leading price, or the starting price before anyone bids. */
export function PriceText({ auction }: { auction: AuctionView }) {
  const { t } = useTranslation();
  return auction.currentPrice === undefined
    ? t("online.market.startsAt", { price: formatVal(auction.startPrice) })
    : formatVal(auction.currentPrice);
}

/** Where the club stands in an auction of its own market (C5-6). */
function standing(auction: AuctionView, clubId: string | undefined): string {
  if (auction.status === "active") {
    if (auction.sellerClubId === clubId) return "selling";
    return auction.leaderClubId === clubId ? "leading" : "holdingCap";
  }
  if (auction.status === "settled") {
    if (auction.winnerClubId === clubId) return "bought";
    return auction.sellerClubId === clubId ? "sold" : "lost";
  }
  return auction.status === "unsold" ? "unsold" : "cancelled";
}

/** The club's own market: what it sells, what it holds money in, what closed this week. */
function MyAuctions() {
  const { t, i18n } = useTranslation();
  const market = useOnlineStore((state) => state.market);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    refreshMarket().catch(setError);
  }, []);
  useEffect(load, [load]);

  if (error !== null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {marketErrorText(t, i18n.language, error)}
        </p>
        <Button variant="outline" size="sm" onClick={load}>
          {t("online.retry")}
        </Button>
      </div>
    );
  }
  if (market === undefined) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>;
  }
  if (market === null) {
    return <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.market.closed")}</p>;
  }
  return <MyGroups market={market} />;
}

type Group = "selling" | "holding" | "recent";

/** The club's three lists as the offline transfer centre's views: a pill each, one table at a time. */
function MyGroups({ market }: { market: MyMarketView }) {
  const { t } = useTranslation();
  const [group, setGroup] = useState<Group>("selling");
  const groups: { id: Group; label: string; items: AuctionView[]; mode: TableMode }[] = [
    { id: "selling", label: t("online.market.selling"), items: market.selling, mode: "mine" },
    { id: "holding", label: t("online.market.holding"), items: market.holding, mode: "mine" },
    { id: "recent", label: t("online.market.recent"), items: market.recent, mode: "closed" },
  ];
  const shown = groups.find((one) => one.id === group) ?? groups[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {groups.map((one) => (
          <button
            type="button"
            key={one.id}
            aria-pressed={group === one.id}
            onClick={() => setGroup(one.id)}
            className={`rounded-lg px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 ${
              group === one.id
                ? "bg-accent-500 text-navy-900 shadow-sm"
                : "border border-gray-200 bg-white text-gray-500 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-400"
            }`}
          >
            {one.label} ({one.items.length})
          </button>
        ))}
      </div>
      <AuctionTable items={shown.items} mode={shown.mode} />
    </div>
  );
}
