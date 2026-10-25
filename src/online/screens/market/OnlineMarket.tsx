import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { translatePositionAbbreviation } from "../../../components/squad/SquadTab.helpers";
import { Badge, Button, Card, CardBody, CardHeader } from "../../../components/ui";
import { formatVal, formatWeeklyAmount } from "../../../lib/valueFormatting";
import type { AuctionView, MarketQuery } from "../../api";
import { online } from "../../client";
import type { OnlineApiError } from "../../errors";
import { refreshMarket, tracked, useOnlineStore } from "../../store/onlineStore";
import PotentialStars from "../PotentialStars";
import { marketErrorText } from "./marketText";
import { useServerCountdown, useServerOffset } from "./useServerCountdown";

/** The groups a coach filters by, as the server names them (`MarketQuery.position`). */
const POSITION_GROUPS = ["Goalkeeper", "Defender", "Midfielder", "Forward"] as const;
const NUMBER_FILTERS = ["minOvr", "maxOvr", "maxPrice", "maxAge"] as const;
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
      <div role="tablist" aria-label={t("online.market.title")} className="flex gap-2">
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
      className={`rounded-lg px-4 py-2 font-heading text-sm font-semibold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-900 ${
        selected
          ? "bg-primary-600 text-white dark:bg-primary-500"
          : "bg-white text-gray-600 hover:text-primary-600 dark:bg-navy-800 dark:text-gray-300 dark:hover:text-primary-400"
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

  const setFilter = (name: string, value: string) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (value === "") copy.delete(name);
        else copy.set(name, value);
        return copy;
      },
      { replace: true },
    );

  return (
    <Card>
      <CardHeader>{t("online.market.openTitle")}</CardHeader>
      <CardBody className="space-y-4">
        <MarketFilters params={params} onChange={setFilter} />
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
            <AuctionTable items={state.items} />
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
      </CardBody>
    </Card>
  );
}

function MarketFilters({
  params,
  onChange,
}: {
  params: URLSearchParams;
  onChange: (name: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const field =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100";
  return (
    <fieldset className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <legend className="sr-only">{t("online.market.filters")}</legend>
      <label className="text-xs text-gray-600 dark:text-gray-300">
        {t("online.market.filter.position")}
        <select
          className={field}
          value={params.get("position") ?? ""}
          onChange={(event) => onChange("position", event.target.value)}
        >
          <option value="">{t("online.market.filter.anyPosition")}</option>
          {POSITION_GROUPS.map((group) => (
            <option key={group} value={group}>
              {t(`online.market.group.${group}`)}
            </option>
          ))}
        </select>
      </label>
      {NUMBER_FILTERS.map((name) => (
        <label key={name} className="text-xs text-gray-600 dark:text-gray-300">
          {t(`online.market.filter.${name}`)}
          <input
            type="number"
            min={0}
            inputMode="numeric"
            className={field}
            value={params.get(name) ?? ""}
            onChange={(event) => onChange(name, event.target.value)}
          />
        </label>
      ))}
    </fieldset>
  );
}

function AuctionTable({ items }: { items: AuctionView[] }) {
  const { t } = useTranslation();
  const offset = useServerOffset(items[0]?.serverNow);
  if (items.length === 0) {
    return <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.market.empty")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-navy-600 dark:text-gray-400">
          <tr>
            <th scope="col" className="px-3 py-2">
              {t("common.name")}
            </th>
            <th scope="col" className="px-2 py-2">
              {t("common.position")}
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              {t("common.age")}
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              {t("common.ovr")}
            </th>
            <th scope="col" className="px-2 py-2">
              {t("online.squad.potential")}
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              {t("common.wage")}
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              {t("online.market.price")}
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              {t("online.market.bids")}
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              {t("online.market.timeLeft")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("online.market.seller")}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((auction) => (
            <AuctionRow key={auction.id} auction={auction} offset={offset} />
          ))}
        </tbody>
      </table>
    </div>
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

function AuctionRow({ auction, offset }: { auction: AuctionView; offset: number }) {
  const { t } = useTranslation();
  const { text } = useServerCountdown(auction.endsAt, offset);
  const player = auction.player;
  return (
    <tr className="border-b border-gray-100 dark:border-navy-600">
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/online/auctions/${auction.id}`}
            className="rounded font-semibold text-gray-900 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-gray-100 dark:hover:text-primary-400 dark:focus:ring-offset-navy-800"
          >
            {player?.fullName ?? t("online.market.retiredPlayer")}
          </Link>
          <OwnLabels auction={auction} />
        </div>
      </td>
      <td className="px-2 py-2">
        {player ? translatePositionAbbreviation(t, player.naturalPosition) : "–"}
      </td>
      <td className="px-2 py-2 text-right">{player?.age ?? "–"}</td>
      <td className="px-2 py-2 text-right font-heading font-bold">{player?.ovr ?? "–"}</td>
      <td className="px-2 py-2">{player && <PotentialStars stars={player.potentialStars} />}</td>
      <td className="px-2 py-2 text-right">
        {player ? formatWeeklyAmount(formatVal(player.wage), t("finances.perWeekSuffix")) : "–"}
      </td>
      <td className="px-2 py-2 text-right font-semibold">
        <PriceText auction={auction} />
      </td>
      <td className="px-2 py-2 text-right">{auction.bidsCount}</td>
      <td className="px-2 py-2 text-right tabular-nums">{text ?? t("online.market.ending")}</td>
      <td className="px-3 py-2">
        <ClubName name={auction.sellerName} isBot={auction.sellerIsBot} />
      </td>
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
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <MyGroup title={t("online.market.selling")} items={market.selling} />
      <MyGroup title={t("online.market.holding")} items={market.holding} />
      <MyGroup title={t("online.market.recent")} items={market.recent} />
    </div>
  );
}

function MyGroup({ title, items }: { title: string; items: AuctionView[] }) {
  const { t } = useTranslation();
  const clubId = useOnlineStore((state) => state.club?.club.id);
  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      <CardBody>
        {items.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.market.none")}</p>
        ) : (
          <ul aria-label={title} className="space-y-2">
            {items.map((auction) => (
              <li key={auction.id} className="flex items-center justify-between gap-2 text-sm">
                <Link
                  to={`/online/auctions/${auction.id}`}
                  className="rounded font-semibold text-gray-900 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-gray-100 dark:hover:text-primary-400 dark:focus:ring-offset-navy-800"
                >
                  {auction.player?.fullName ?? t("online.market.retiredPlayer")}
                </Link>
                <span className="text-right text-gray-600 dark:text-gray-300">
                  <PriceText auction={auction} /> ·{" "}
                  {t(`online.market.standing.${standing(auction, clubId)}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
