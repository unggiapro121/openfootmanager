import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Coins, Store } from "lucide-react";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
import { Button, Card, CardBody, CardHeader } from "../../../components/ui";
import type { CoinView, InventoryView, ShopItemView, ShopView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { formatCoins } from "../../format";
import { refreshCoins, refreshItems, tracked, useOnlineStore } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import MoneyInput from "../market/MoneyInput";
import ResourceState from "../ResourceState";
import { useActionKey } from "../useActionKey";
import {
  capsText,
  effectText,
  groupOf,
  ITEM_GROUPS,
  itemDescription,
  itemName,
  itemsErrorText,
} from "./itemText";

const PRICE_CHANGED = "be.error.economy.priceChanged";
const STACK_FULL = "be.error.inventory.stackFull";
/** The most of one item bought at once when an older server sends no `maxPurchase`. */
const MOST_AT_ONCE = 99;

/**
 * Why the item cannot be bought, in the order the coach would read it (C-7 C7-30); `null` when it
 * can. The server sells an item its season cannot use (S-17 §3.1), so the shop says so first.
 */
export function buyBlocker(
  t: TFunction,
  item: ShopItemView,
  coins: CoinView | null | undefined,
  items: InventoryView | null | undefined,
): string | null {
  if (item.powerClass === "c" && item.effect === undefined) return t("online.shop.notThisSeason");
  if (item.powerClass === "b") return t("online.shop.academySoon");
  if (item.maxPurchase === 0) {
    if (coins?.coinLocked) return t("online.coins.locked");
    if (items?.locked) return t("online.shop.itemsLocked");
    return t("online.shop.full");
  }
  if (coins?.blocked) return t("be.error.economy.coinLocked");
  if (coins && coins.balance < item.price) return t("be.error.economy.insufficientCoin");
  return null;
}

/**
 * The shop (C-7b, C7-16, C7-30): what the price list in force sells, what each does this season
 * by the ruleset's numbers, and a purchase confirmed with the price list shown. Bought items never
 * expire. Coins and items are the person's, so the page opens without a club.
 */
export default function OnlineShop() {
  const { t } = useTranslation();
  const coins = useOnlineStore((state) => state.coins);
  const items = useOnlineStore((state) => state.items);
  const [params, setParams] = useSearchParams();
  const [done, setDone] = useState<string | null>(null);
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
        return (
          <div className="flex flex-col gap-5">
            <Header coins={coins} version={version} />
            {done && (
              <p role="status" className="text-sm text-green-700 dark:text-green-400">
                {done}
              </p>
            )}
            <Catalogue
              shop={shop}
              onBuy={(code) => {
                setDone(null);
                setParams({ item: code }, { replace: true });
              }}
            />
            {buying && buyBlocker(t, buying, coins, items) === null && (
              <PurchaseDialog
                item={buying}
                version={version}
                onClose={close}
                onChanged={readAgain}
                onDone={(text) => {
                  close();
                  setDone(text);
                  readAgain();
                }}
              />
            )}
          </div>
        );
      }}
    </ResourceState>
  );
}

function Header({ coins, version }: { coins: CoinView | null | undefined; version: number }) {
  const { t, i18n } = useTranslation();
  return (
    <Card accent="accent">
      <CardBody>
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700 dark:text-gray-300">
          <span className="flex items-center gap-2 font-heading text-lg font-bold">
            <Coins className="h-5 w-5 text-accent-500 dark:text-accent-400" aria-hidden="true" />
            {coins ? formatCoins(coins.balance, i18n.language) : "—"}
          </span>
          <Link
            to="/online/coins"
            className="font-semibold text-primary-700 underline dark:text-primary-400"
          >
            {t("online.shop.toWallet")}
          </Link>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.coins.priceList", { version })}
          </span>
          <span className="w-full text-xs text-gray-500 dark:text-gray-400">
            {t("online.shop.neverExpire")}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function Catalogue({ shop, onBuy }: { shop: ShopView; onBuy: (code: string) => void }) {
  const { t } = useTranslation();
  if (shop.items.length === 0) {
    return <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.shop.empty")}</p>;
  }
  return (
    <>
      {ITEM_GROUPS.map((group) => {
        const offered = shop.items.filter((item) => groupOf(item.itemCode) === group);
        if (offered.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`shop-${group}`} className="space-y-3">
            <h3
              id={`shop-${group}`}
              className="font-heading text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
            >
              {t(`online.inventory.group.${group}`)}
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {offered.map((item) => (
                <Offer key={item.itemCode} item={item} onBuy={() => onBuy(item.itemCode)} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function Offer({ item, onBuy }: { item: ShopItemView; onBuy: () => void }) {
  const { t, i18n } = useTranslation();
  const coins = useOnlineStore((state) => state.coins);
  const items = useOnlineStore((state) => state.items);
  const blocker = buyBlocker(t, item, coins, items);
  const lines = [
    ...(item.effect ? effectText(t, item.effect) : []),
    ...(item.limits ? capsText(t, item.limits) : []),
  ];
  return (
    <article aria-label={itemName(t, item.itemCode)}>
      <Card>
        <CardHeader>
          <span className="flex items-center gap-2">
            <Store className="h-4 w-4 text-accent-500 dark:text-accent-400" aria-hidden="true" />
            {itemName(t, item.itemCode)}
            <span className="ml-auto flex items-center gap-1 tabular-nums">
              <Coins className="h-4 w-4 text-accent-500 dark:text-accent-400" aria-hidden="true" />
              {formatCoins(item.price, i18n.language)}
            </span>
          </span>
        </CardHeader>
        <CardBody>
          <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
            {itemDescription(t, item.itemCode) && <p>{itemDescription(t, item.itemCode)}</p>}
            {lines.map((line) => (
              <p key={line} className="text-xs">
                {line}
              </p>
            ))}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {blocker && (
                <span role="note" className="text-xs text-gray-500 dark:text-gray-400">
                  {blocker}
                </span>
              )}
              <Button type="button" size="sm" disabled={blocker !== null} onClick={onBuy}>
                {t("online.shop.buy")}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </article>
  );
}

/**
 * A purchase asked once more (C-7 C7-6): it shows the price list it will send. No answer: sent
 * again under the same key. A changed price list or a row with less room is read again and shown;
 * confirming it then is a new request with a new key, never sent by itself.
 */
function PurchaseDialog({
  item,
  version,
  onClose,
  onChanged,
  onDone,
}: {
  item: ShopItemView;
  version: number;
  onClose: () => void;
  onChanged: () => void;
  onDone: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const coins = useOnlineStore((state) => state.coins);
  const most = Math.min(item.maxPurchase ?? MOST_AT_ONCE, MOST_AT_ONCE);
  const [quantity, setQuantity] = useState<number | null>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();

  const total = quantity === null ? 0 : quantity * item.price;
  const balance = coins?.balance;
  const tooMany = quantity !== null && quantity > most;
  const tooDear = balance !== undefined && total > balance;
  const ready = quantity !== null && quantity >= 1 && !tooMany && !tooDear && !busy;

  const confirm = () => {
    if (quantity === null) return;
    setBusy(true);
    setError(null);
    run(
      (key) => tracked(() => online.shop.purchase(item.itemCode, quantity, version, key)),
      `${item.itemCode}x${quantity}@${version}`,
    )
      .then((view) => {
        useOnlineStore.setState((state) => ({
          coins: state.coins ? { ...state.coins, balance: view.coinBalance } : state.coins,
        }));
        void refreshCoins().catch(() => undefined);
        void refreshItems().catch(() => undefined);
        onDone(
          t("online.shop.bought", {
            count: view.quantity,
            item: itemName(t, view.itemCode),
            coins: formatCoins(view.coins, i18n.language),
          }),
        );
      })
      .catch((failure: unknown) => {
        setError(failure);
        if (!(failure instanceof OnlineApiError) || failure.status === 0) return;
        if (failure.code === STACK_FULL && typeof failure.params.max === "number") {
          setQuantity(failure.params.max);
        }
        void refreshCoins().catch(() => undefined);
        if (failure.code === PRICE_CHANGED || failure.code === STACK_FULL) onChanged();
      })
      .finally(() => setBusy(false));
  };

  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div role="dialog" aria-modal="true" aria-labelledby="shop-buy-title" className="space-y-4">
        <h3
          id="shop-buy-title"
          className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
        >
          {t("online.shop.confirmTitle", { item: itemName(t, item.itemCode) })}
        </h3>
        <MoneyInput
          label={t("online.shop.quantity", { max: most })}
          value={quantity}
          onChange={(value) => {
            setError(null);
            setQuantity(value);
          }}
        />
        {most < MOST_AT_ONCE && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.shop.room", { max: most })}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
          <dt>{t("online.shop.price")}</dt>
          <dd className="text-right tabular-nums">{formatCoins(item.price, i18n.language)}</dd>
          <dt>{t("online.shop.total")}</dt>
          <dd className="text-right font-semibold tabular-nums">
            {formatCoins(total, i18n.language)}
          </dd>
          {balance !== undefined && (
            <>
              <dt>{t("online.shop.after")}</dt>
              <dd className="text-right tabular-nums">
                {formatCoins(balance - total, i18n.language)}
              </dd>
            </>
          )}
          <dt>{t("online.coins.priceListLabel")}</dt>
          <dd className="text-right tabular-nums">{version}</dd>
        </dl>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t("online.shop.bound")}</p>
        {(tooMany || tooDear) && (
          <p role="note" className="text-xs text-red-600 dark:text-red-400">
            {tooMany
              ? t("online.shop.room", { max: most })
              : t("be.error.economy.insufficientCoin")}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {itemsErrorText(t, i18n.language, error)}
            {error instanceof OnlineApiError &&
              error.code === PRICE_CHANGED &&
              ` ${t("online.coins.reviewPrices")}`}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" size="sm" disabled={!ready} onClick={confirm}>
            {t("online.shop.confirm")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
