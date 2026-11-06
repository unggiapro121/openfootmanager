import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal } from "lucide-react";
import { formatVal } from "../../../../lib/valueFormatting";
import type { AuctionView, MyMarketView } from "../../../api";
import { refreshMarket, useOnlineStore } from "../../../store/onlineStore";
import { PhoneHeaderPart } from "../../mobile/PhoneHeaderSlots";
import { FOCUS } from "../../mobile/PhoneSheet";
import { POSITION_GROUPS } from "../MarketFilterPanel";
import { marketErrorText } from "../marketText";
import { standing } from "../OnlineMarket";
import { useServerOffset } from "../useServerCountdown";
import { byName, useMarketParams, useOpenAuctions } from "../useOpenAuctions";
import { AuctionCard, KEY, type Standing, type StandingTone } from "./AuctionCard";
import {
  ActiveFilterChips,
  activeFilters,
  MarketFilterSheet,
  narrow,
  sortAuctions,
  sortOf,
} from "./PhoneMarketFilters";

type Tab = "open" | "mine";

const BUTTON = `rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-200 ${FOCUS}`;

/**
 * The market on a phone (design m-cho): the open auctions as cards under a search, the position
 * groups and a filter sheet, and the club's own auctions on the second tab. The filters live in
 * the address, as on a desktop, so the way back from an auction keeps them.
 */
export default function PhoneMarket() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "mine" ? "mine" : "open";
  const marketUnseen = useOnlineStore((state) => state.marketUnseen);
  const market = useOnlineStore((state) => state.market);
  const [openCount, setOpenCount] = useState<number | null>(null);

  useEffect(() => {
    if (marketUnseen > 0) useOnlineStore.setState({ marketUnseen: 0 });
  }, [marketUnseen]);
  useEffect(() => {
    if (market === undefined) void refreshMarket().catch(() => undefined);
  }, [market]);

  const choose = (next: Tab) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (next === "mine") copy.set("tab", "mine");
        else copy.delete("tab");
        return copy;
      },
      { replace: true },
    );
  const tabs: { id: Tab; label: string; count: number | null }[] = [
    { id: "open", label: t("online.market.tabOpen"), count: openCount },
    {
      id: "mine",
      label: t("online.market.tabMine"),
      count: market ? market.selling.length + market.holding.length : null,
    },
  ];

  return (
    <div className="-mx-3 -mt-3 flex flex-col">
      <PhoneHeaderPart place="below">
        <div
          role="tablist"
          aria-label={t("online.market.title")}
          className="grid grid-cols-2 border-t border-gray-200 px-4 dark:border-navy-700"
        >
          {tabs.map((one) => {
            const on = one.id === tab;
            return (
              <button
                key={one.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => choose(one.id)}
                className={`-mb-px flex h-11 items-center justify-center gap-1.5 border-b-2 font-heading text-[15px] font-bold uppercase tracking-wider ${on ? "border-primary-500 text-gray-900 dark:text-white" : "border-transparent text-gray-500 dark:text-gray-400"} ${FOCUS}`}
              >
                {one.label}
                {one.count !== null && (
                  <span
                    className={`rounded-full px-1.5 font-sans text-[11px] leading-[18px] ${on ? "bg-primary-500 text-white dark:text-navy-900" : "bg-gray-200 text-gray-600 dark:bg-navy-700 dark:text-gray-300"}`}
                  >
                    {one.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </PhoneHeaderPart>
      {tab === "open" ? (
        <OpenList ring={marketUnseen} onCount={setOpenCount} />
      ) : (
        <MineList market={market} />
      )}
    </div>
  );
}

/** The open auctions as cards: a search, the groups, the filter sheet, then the cards. */
function OpenList({ ring, onCount }: { ring: number; onCount: (count: number | null) => void }) {
  const { t, i18n } = useTranslation();
  const { params, queryKey, search, setSearch, setFilter } = useMarketParams();
  const { state, load, more, moreError } = useOpenAuctions(queryKey, ring);
  const cash = useOnlineStore((store) => store.finance?.cash);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sort = sortOf(params);
  const items = state.status === "ready" ? state.items : null;
  const shown = useMemo(
    () => sortAuctions(narrow(byName(items ?? [], search), params), sort),
    [items, search, params, sort],
  );
  const offset = useServerOffset(items?.[0]?.serverNow);
  const group = params.get("position") ?? "";
  const active = activeFilters(params, t);
  const filtersOn = active.length;

  useEffect(() => onCount(items ? items.length : null), [items, onCount]);

  const chip = (value: string, label: string) => {
    const on = value === group;
    return (
      <button
        key={value || "all"}
        type="button"
        aria-pressed={on}
        onClick={() => setFilter({ position: value, naturalPosition: "" })}
        className={`h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold ${on ? "border-primary-500 bg-primary-50 text-gray-900 dark:bg-primary-900/40 dark:text-white" : "border-gray-200 bg-white text-gray-700 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-200"} ${FOCUS}`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-6 pt-3">
      {cash !== undefined && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t(`${KEY}.budget`)}{" "}
          <strong className="font-heading text-sm text-gray-900 dark:text-white">
            {formatVal(cash)}
          </strong>
        </p>
      )}
      <div className="flex gap-2">
        <label className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label={t("transfers.searchByName")}
            placeholder={t("transfers.searchByName")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-[15px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/60 dark:border-navy-700 dark:bg-navy-800 dark:text-white dark:placeholder-gray-500"
          />
        </label>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setSheetOpen(true)}
          className={`flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold ${filtersOn > 0 ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300" : "border-gray-200 bg-white text-gray-700 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-200"} ${FOCUS}`}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {t("online.market.filters")}
          {filtersOn > 0 && (
            <span className="rounded-full bg-primary-600 px-1.5 text-[11px] leading-[18px] text-white">
              {filtersOn}
            </span>
          )}
        </button>
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5">
        {chip("", t(`${KEY}.allPositions`))}
        {POSITION_GROUPS.map((value) => chip(value, t(`online.market.group.${value}`)))}
      </div>
      <ActiveFilterChips filters={active} onClear={setFilter} />

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
          <button type="button" onClick={load} className={BUTTON}>
            {t("online.retry")}
          </button>
        </div>
      )}
      {state.status === "ready" && (
        <>
          <p className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>
              {t(`${KEY}.count`, { count: shown.length, sort: t(`${KEY}.sort.${sort}`) })}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
              {t(`${KEY}.urgent`)}
            </span>
          </p>
          {shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {t("online.market.empty")}
            </p>
          ) : (
            <ul aria-label={t(`${KEY}.list`)} className="flex flex-col gap-2">
              {shown.map((auction) => (
                <li key={auction.id}>
                  <AuctionCard auction={auction} offset={offset} />
                </li>
              ))}
            </ul>
          )}
          {moreError !== null && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {marketErrorText(t, i18n.language, moreError)}
            </p>
          )}
          {state.cursor && (
            <button type="button" onClick={() => more(state.cursor as string)} className={BUTTON}>
              {t("online.market.more")}
            </button>
          )}
        </>
      )}
      {sheetOpen && (
        <MarketFilterSheet
          params={params}
          search={search}
          onApply={(patch) => {
            setFilter(patch);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

/** How a standing in the club's own lists reads: what is going its way, what is not. */
const STANDING_TONE: Record<string, StandingTone> = {
  leading: "good",
  bought: "good",
  sold: "good",
  lost: "bad",
};

/** The club's own auctions: what it sells, what it holds money in, what closed this week. */
function MineList({ market }: { market: MyMarketView | null | undefined }) {
  const { t, i18n } = useTranslation();
  const clubId = useOnlineStore((state) => state.club?.club.id);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    refreshMarket().catch(setError);
  }, []);
  useEffect(load, [load]);

  if (error !== null) {
    return (
      <div className="flex flex-col items-start gap-3 px-4 pt-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {marketErrorText(t, i18n.language, error)}
        </p>
        <button type="button" onClick={load} className={BUTTON}>
          {t("online.retry")}
        </button>
      </div>
    );
  }
  if (market === undefined)
    return (
      <p className="px-4 pt-3 text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>
    );
  if (market === null)
    return (
      <p className="px-4 pt-3 text-sm text-gray-600 dark:text-gray-300">
        {t("online.market.closed")}
      </p>
    );

  const standingOf = (auction: AuctionView): Standing => {
    const place = standing(auction, clubId);
    return { label: `online.market.standing.${place}`, tone: STANDING_TONE[place] ?? "neutral" };
  };
  const groups = [
    { id: "selling", items: market.selling },
    { id: "holding", items: market.holding },
    { id: "recent", items: market.recent },
  ];
  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-3">
      {groups.map((group) => (
        <MineGroup
          key={group.id}
          title={t(`online.market.${group.id}`)}
          items={group.items}
          standingOf={standingOf}
        />
      ))}
    </div>
  );
}

function MineGroup({
  title,
  items,
  standingOf,
}: {
  title: string;
  items: AuctionView[];
  standingOf: (auction: AuctionView) => Standing;
}) {
  const { t } = useTranslation();
  const offset = useServerOffset(items[0]?.serverNow);
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 font-heading text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {title}
        <span className="rounded-full bg-gray-200 px-1.5 font-sans text-[11px] leading-[18px] text-gray-600 dark:bg-navy-700 dark:text-gray-300">
          {items.length}
        </span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.market.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((auction) => (
            <li key={auction.id}>
              <AuctionCard auction={auction} offset={offset} standing={standingOf(auction)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
