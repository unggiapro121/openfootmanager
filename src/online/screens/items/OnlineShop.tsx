import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, Coins, Info, Store } from "lucide-react";
import type { CoinView, InventoryView, SeasonNowView, ShopItemView, ShopView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { formatCoins } from "../../format";
import { refreshCoins, refreshItems, tracked, useOnlineStore } from "../../store/onlineStore";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import { useOnlineResource } from "../../useOnlineResource";
import ResourceState from "../ResourceState";
import { type ItemGroup, groupOf, ITEM_GROUPS, itemDescription, itemName } from "./itemText";
import { ItemIcon, lookOf } from "./itemLook";
import ItemsToast from "./ItemsToast";
import ShopPurchaseDialog from "./ShopPurchaseDialog";
import type { Usable } from "./ShopPurchaseParts";
import { PhoneOffer, PhoneShopHead } from "./ShopPhone";

/**
 * What the season lacks for the item, in the coach's words (S-17d S17d-4, C-7b2): an academy, or
 * item rules (and any lack this build does not know).
 */
function needsText(t: TFunction, needs: string): string {
  return needs === "academy" ? t("online.shop.needsAcademy") : t("online.shop.notThisSeason");
}

/**
 * Why the item cannot be bought, in the order the coach would read it (C-7 C7-30); `null` when it
 * can. The server says what the season lacks for an item (`needs`, S-17d), so the shop says so
 * first. A server older than S-17d sends no `needs` and sells an item its season cannot use
 * (S-17 §3.1): an item with no numbers is then not usable this season (C-7 §17.4).
 */
export function buyBlocker(
  t: TFunction,
  item: ShopItemView,
  coins: CoinView | null | undefined,
  items: InventoryView | null | undefined,
): string | null {
  if (item.needs !== undefined) return needsText(t, item.needs);
  if (item.powerClass === "c" && item.effect === undefined) return t("online.shop.notThisSeason");
  if (item.maxPurchase === 0) {
    if (coins?.coinLocked) return t("online.coins.locked");
    if (items?.locked) return t("online.shop.itemsLocked");
    return t("online.shop.full");
  }
  if (coins?.blocked) return t("be.error.economy.coinLocked");
  if (coins && coins.balance < item.price) return t("be.error.economy.insufficientCoin");
  return null;
}

/** How many of an item the coach holds now. */
export function heldOf(items: InventoryView | null | undefined, code: string): number {
  return items?.lines.find((line) => line.itemCode === code)?.total ?? 0;
}

/**
 * When a bought item can be used: renames at once, the rest once a season is under way. A season
 * that is over or not yet open keeps them in the inventory until it is.
 */
export function usableOf(group: ItemGroup, season: SeasonNowView | null | undefined): Usable {
  if (group === "custom") return "now";
  if (season?.status === "closing" || season?.status === "closed") return "nextSeason";
  if (season?.status === "scheduled") return "seasonStart";
  return "now";
}

type Filter = ItemGroup | "all";

/**
 * The shop (C-7b, C7-16, C7-30; design cua-hang.html): the balance, what the price list in force
 * sells by group, and a purchase confirmed with the price list shown. Bought items never expire.
 * Coins and items are the person's, so the page opens without a club.
 */
export default function OnlineShop() {
  const { t } = useTranslation();
  const coins = useOnlineStore((state) => state.coins);
  const items = useOnlineStore((state) => state.items);
  const season = useOnlineStore((state) => state.season);
  const [params, setParams] = useSearchParams();
  const [done, setDone] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const phone = usePhoneLayout();
  const { resource, reload } = useOnlineResource(() => tracked(() => online.shop.view()), []);
  // Read again in place after a purchase or a changed price list, so an open dialog stays open.
  const [fresh, setFresh] = useState<ShopView | null>(null);
  const readAgain = () => {
    tracked(() => online.shop.view())
      .then(setFresh)
      .catch(() => undefined);
  };

  useEffect(() => {
    void refreshCoins().catch(() => undefined);
    void refreshItems().catch(() => undefined);
  }, []);

  const asked = params.get("item");
  const close = () => setParams({}, { replace: true });

  if (
    resource.status === "failed" &&
    resource.error instanceof OnlineApiError &&
    resource.error.status === 404
  ) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.shop.notOnServer")}</p>
    );
  }
  return (
    <ResourceState resource={resource} reload={reload}>
      {(first) => {
        const shop = fresh ?? first;
        if (shop.priceListVersion === undefined) {
          return (
            <p
              role="status"
              className="rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-300"
            >
              {t("online.shop.closed")}
            </p>
          );
        }
        const version = shop.priceListVersion;
        const buying = shop.items.find((item) => item.itemCode === asked);
        const groups = ITEM_GROUPS.filter((group) =>
          shop.items.some((item) => groupOf(item.itemCode) === group),
        );
        // A group the shop no longer sells falls back to everything.
        const shown: Filter = filter !== "all" && groups.includes(filter) ? filter : "all";
        return (
          <div className="flex flex-col gap-6 max-md:gap-3.5">
            {phone ? (
              <PhoneShopHead coins={coins} season={season} version={version} />
            ) : (
              <ShopHead coins={coins} season={season} version={version} />
            )}
            {shop.items.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.shop.empty")}</p>
            ) : (
              <>
                <FilterChips shop={shop} groups={groups} shown={shown} onPick={setFilter} />
                <div className="flex flex-col gap-8 max-md:gap-3.5">
                  {groups
                    .filter((group) => shown === "all" || group === shown)
                    .map((group) => (
                      <GroupSection
                        key={group}
                        group={group}
                        phone={phone}
                        offers={shop.items.filter((item) => groupOf(item.itemCode) === group)}
                        onBuy={(code) => {
                          setDone(null);
                          setParams({ item: code }, { replace: true });
                        }}
                      />
                    ))}
                </div>
              </>
            )}
            {buying && buyBlocker(t, buying, coins, items) === null && (
              <ShopPurchaseDialog
                item={buying}
                version={version}
                usable={usableOf(groupOf(buying.itemCode), season)}
                onClose={close}
                onChanged={readAgain}
                onDone={(text) => {
                  close();
                  setDone(text);
                  readAgain();
                }}
              />
            )}
            {done && (
              <ItemsToast
                text={done}
                link={{ to: "/online/inventory", label: t("online.shop.openInventory") }}
                onClose={() => setDone(null)}
              />
            )}
          </div>
        );
      }}
    </ResourceState>
  );
}

/** The season's word on bought items, beside the coin balance and the price list in force. */
function ShopHead({
  coins,
  season,
  version,
}: {
  coins: CoinView | null | undefined;
  season: SeasonNowView | null | undefined;
  version: number;
}) {
  const { t, i18n } = useTranslation();
  const over = season?.status === "closing" || season?.status === "closed";
  const soon = season?.status === "scheduled";
  const title = over
    ? t("online.shop.seasonOverTitle", { number: season.number })
    : soon
      ? t("online.shop.seasonSoonTitle", { number: season.number })
      : t("online.shop.openTitle");
  const negative = coins !== null && coins !== undefined && coins.balance < 0;
  return (
    <section
      aria-labelledby="shop-head-title"
      className="flex flex-wrap items-center gap-5 rounded-xl border border-t-4 border-gray-200 border-t-accent-400 bg-white px-6 py-5 shadow-sm dark:border-navy-600 dark:border-t-accent-400 dark:bg-navy-700 dark:shadow-md"
    >
      <div className="flex min-w-0 flex-[999_1_420px] items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
          {over || soon ? (
            <CalendarClock className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Store className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
        <div className="flex flex-col gap-1">
          <h2
            id="shop-head-title"
            className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
          >
            {title}
          </h2>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            {(over || soon) && (
              <>
                <span>
                  {t(over ? "online.shop.seasonOverText" : "online.shop.seasonSoonText")}
                </span>{" "}
              </>
            )}
            <span>{t("online.shop.neverExpire")}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-[1_1_220px] flex-col items-end gap-0.5">
        <span className="font-heading text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
          {t("online.shop.balance")}
        </span>
        <span
          className={`flex items-center gap-2 font-heading text-3xl font-bold leading-none tabular-nums ${
            negative ? "text-red-600 dark:text-red-400" : "text-accent-600 dark:text-accent-400"
          }`}
        >
          <Coins className="h-6 w-6" aria-hidden="true" />
          {coins ? formatCoins(coins.balance, i18n.language) : "—"}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.coins.priceList", { version })} ·{" "}
          <Link
            to="/online/coins"
            className="rounded font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
          >
            {t("online.shop.toWallet")}
          </Link>
        </span>
      </div>
    </section>
  );
}

function FilterChips({
  shop,
  groups,
  shown,
  onPick,
}: {
  shop: ShopView;
  groups: ItemGroup[];
  shown: Filter;
  onPick: (filter: Filter) => void;
}) {
  const { t } = useTranslation();
  const chips: { filter: Filter; label: string; count: number }[] = [
    { filter: "all", label: t("common.all"), count: shop.items.length },
    ...groups.map((group) => ({
      filter: group,
      label: t(`online.inventory.group.${group}`),
      count: shop.items.filter((item) => groupOf(item.itemCode) === group).length,
    })),
  ];
  return (
    // On a phone the chips stay under the app bar while the list scrolls (m-cua-hang).
    <div className="max-md:sticky max-md:top-[var(--phone-header-h)] max-md:z-10 max-md:-mx-3 max-md:bg-gray-100 max-md:px-3 max-md:py-2 max-md:dark:bg-navy-900">
      <fieldset className="flex flex-wrap gap-2 max-md:flex-nowrap max-md:overflow-x-auto">
        <legend className="sr-only">{t("online.shop.filterLabel")}</legend>
        {chips.map((chip) => {
          const on = chip.filter === shown;
          return (
            <button
              key={chip.filter}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(chip.filter)}
              className={`rounded-lg border px-3.5 py-2 font-heading text-sm font-semibold uppercase tracking-wider transition-colors max-md:h-9 max-md:shrink-0 max-md:rounded-full max-md:py-0 max-md:font-sans max-md:text-[13px] max-md:normal-case max-md:tracking-normal focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800 ${
                on
                  ? "border-primary-700 bg-primary-700 text-white dark:border-primary-700 dark:bg-primary-700 dark:text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:border-primary-500 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-300 dark:hover:border-primary-500"
              }`}
            >
              {chip.label} <span className="tabular-nums">({chip.count})</span>
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

function GroupSection({
  group,
  phone,
  offers,
  onBuy,
}: {
  group: ItemGroup;
  phone: boolean;
  offers: ShopItemView[];
  onBuy: (code: string) => void;
}) {
  const { t } = useTranslation();
  const hint = t(`online.shop.hint.${group}`, { defaultValue: "" });
  return (
    <section aria-labelledby={`shop-${group}`} className="flex flex-col gap-3 max-md:gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 max-md:flex-col max-md:items-start max-md:gap-0.5">
        <h2
          id={`shop-${group}`}
          className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 max-md:text-[17px] dark:text-gray-100"
        >
          {t(`online.inventory.group.${group}`)}
        </h2>
        {hint && <span className="text-xs text-gray-500 dark:text-gray-400">{hint}</span>}
      </div>
      <div className="grid grid-cols-1 gap-4 max-md:grid-cols-2 max-md:gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {offers.map((item) => (
          <Offer key={item.itemCode} item={item} phone={phone} onBuy={() => onBuy(item.itemCode)} />
        ))}
      </div>
    </section>
  );
}

/** What the item is used on, as a badge; a tactical note shows its mastery band instead. */
export function ScopeBadge({ code }: { code: string }) {
  const { t } = useTranslation();
  const look = lookOf(code);
  if (look.masteryTier !== undefined) {
    const tier = look.masteryTier;
    const word = (["low", "mid", "high"] as const)[tier - 1];
    return (
      <span className="inline-flex items-center gap-2 self-start">
        <span aria-hidden="true" data-mastery-bars className="inline-flex gap-0.75">
          {[1, 2, 3].map((step) => (
            <span
              key={step}
              className={`h-1.5 w-3.5 rounded-full ${
                step <= tier ? "bg-primary-500 dark:bg-primary-400" : "bg-gray-200 dark:bg-navy-600"
              }`}
            />
          ))}
        </span>
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {t(`online.shop.mastery.${word}`)}
        </span>
      </span>
    );
  }
  if (look.scope === undefined) return null;
  const tone = look.gold
    ? "bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300"
    : look.scope === "eleven"
      ? "bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
      : "bg-gray-100 text-gray-600 dark:bg-navy-600 dark:text-gray-400";
  return (
    <span
      className={`inline-flex self-start rounded-md px-2 py-0.5 font-heading text-xs font-semibold uppercase tracking-wider ${tone}`}
    >
      {t(`online.shop.scope.${look.scope}`)}
    </span>
  );
}

function Offer({ item, phone, onBuy }: { item: ShopItemView; phone: boolean; onBuy: () => void }) {
  const { t, i18n } = useTranslation();
  const coins = useOnlineStore((state) => state.coins);
  const items = useOnlineStore((state) => state.items);
  const blocker = buyBlocker(t, item, coins, items);
  if (phone) {
    return (
      <PhoneOffer item={item} blocker={blocker} held={heldOf(items, item.itemCode)} onBuy={onBuy} />
    );
  }
  const name = itemName(t, item.itemCode);
  const description = itemDescription(t, item.itemCode);
  const price = formatCoins(item.price, i18n.language);
  return (
    <article
      aria-label={name}
      className="flex flex-col gap-3.5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-primary-400/40 dark:border-navy-600 dark:bg-navy-700 dark:shadow-md dark:hover:border-primary-400/40"
    >
      <div className="flex items-start gap-3">
        <ItemIcon code={item.itemCode} size="md" />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="font-heading text-lg font-bold uppercase leading-tight tracking-wider text-gray-900 dark:text-gray-100">
            {name}
          </h3>
          {description && (
            <p className="text-sm leading-snug text-gray-600 dark:text-gray-400">{description}</p>
          )}
        </div>
      </div>
      <ScopeBadge code={item.itemCode} />
      {blocker && (
        <p
          role="note"
          className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400"
        >
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {blocker}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-gray-200 pt-3.5 dark:border-navy-600">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.shop.held")}{" "}
          <strong className="tabular-nums text-gray-800 dark:text-gray-200">
            {heldOf(items, item.itemCode)}
          </strong>
        </span>
        <button
          type="button"
          disabled={blocker !== null}
          onClick={onBuy}
          aria-label={t("online.shop.buyAria", { item: name, coins: price })}
          className="inline-flex h-11 min-w-22 items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 font-heading text-xl font-bold tabular-nums text-accent-400 shadow-md transition-all hover:bg-primary-800 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary-700 dark:focus:ring-offset-navy-800"
        >
          <Coins className="h-4.5 w-4.5" aria-hidden="true" />
          {price}
        </button>
      </div>
    </article>
  );
}
