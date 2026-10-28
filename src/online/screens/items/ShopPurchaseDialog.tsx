import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Check, Coins, Minus, Plus } from "lucide-react";
import type { ShopItemView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { formatCoins } from "../../format";
import { refreshCoins, refreshItems, tracked, useOnlineStore } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";
import ItemDialogFrame, { FRAME_ACTION, FrameCancel, HeadBadge } from "./ItemDialogFrame";
import { lookOf } from "./itemLook";
import {
  capsText,
  effectText,
  groupOf,
  itemDescription,
  itemName,
  itemsErrorText,
} from "./itemText";

const PRICE_CHANGED = "be.error.economy.priceChanged";
const STACK_FULL = "be.error.inventory.stackFull";
/** The most of one item bought at once when an older server sends no `maxPurchase`. */
const MOST_AT_ONCE = 99;
/** Quick picks beside the stepper (design cua-hang.html). */
const PRESETS = [5, 10];

/** When a bought item can be used, as the dialog says it. */
export type Usable = "now" | "nextSeason" | "seasonStart";

const USABLE_KEY: Record<Usable, string> = {
  now: "online.shop.usableNow",
  nextSeason: "online.shop.usableNextSeason",
  seasonStart: "online.shop.usableSeasonStart",
};

/**
 * A purchase asked once more (C-7 C7-6): what the item does, how many, the total and the balance
 * after, and the price list it will send. No answer: sent again under the same key. A changed
 * price list or a row with less room is read again and shown; confirming it then is a new request
 * with a new key, never sent by itself.
 */
export default function ShopPurchaseDialog({
  item,
  version,
  usable,
  onClose,
  onChanged,
  onDone,
}: {
  item: ShopItemView;
  version: number;
  usable: Usable;
  onClose: () => void;
  onChanged: () => void;
  onDone: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const coins = useOnlineStore((state) => state.coins);
  const held =
    useOnlineStore((state) => state.items)?.lines.find((line) => line.itemCode === item.itemCode)
      ?.total ?? 0;
  const most = Math.min(item.maxPurchase ?? MOST_AT_ONCE, MOST_AT_ONCE);
  const [quantity, setQuantity] = useState<number | null>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();
  const descriptionId = useId();

  const name = itemName(t, item.itemCode);
  const group = groupOf(item.itemCode);
  const look = lookOf(item.itemCode);
  const effects = item.effect ? effectText(t, item.effect) : [];
  const caps = item.limits ? capsText(t, item.limits) : [];
  const total = quantity === null ? 0 : quantity * item.price;
  const balance = coins?.balance;
  const tooMany = quantity !== null && quantity > most;
  const tooDear = balance !== undefined && total > balance;
  const ready = quantity !== null && quantity >= 1 && !tooMany && !tooDear && !busy;
  const coinsText = (amount: number) =>
    t("online.shop.coinsAmount", { coins: formatCoins(amount, i18n.language) });

  const pick = (value: number | null) => {
    setError(null);
    setQuantity(value);
  };
  const step = (by: number) => pick(Math.max(1, Math.min(most, (quantity ?? 0) + by)));

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

  const stepButton =
    "flex h-11 w-11 items-center justify-center text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-navy-600";

  return (
    <ItemDialogFrame
      code={item.itemCode}
      title={name}
      busy={busy}
      describedBy={descriptionId}
      onClose={onClose}
      badges={
        <HeadBadge tone={look.gold ? "gold" : "green"}>
          {t(`online.inventory.group.${group}`)}
        </HeadBadge>
      }
    >
      <div className="flex flex-col gap-2.5">
        <span className="font-heading text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
          {t("online.shop.effectLabel")}
        </span>
        <p id={descriptionId} className="text-base leading-normal text-gray-900 dark:text-gray-100">
          {itemDescription(t, item.itemCode)}
        </p>
        {effects.length > 0 && (
          <ul className="flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-navy-600 dark:bg-navy-900">
            {effects.map((line) => (
              <li
                key={line}
                className="flex items-start gap-2.5 text-sm font-semibold leading-snug text-primary-700 dark:text-primary-400"
              >
                <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
        )}
        {caps.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
            {caps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
        {look.scope && (
          <>
            <dt className="text-gray-500 dark:text-gray-400">{t("online.shop.appliesTo")}</dt>
            <dd className="text-right font-semibold text-gray-900 dark:text-gray-100">
              {t(`online.shop.scope.${look.scope}`)}
            </dd>
          </>
        )}
        <dt className="text-gray-500 dark:text-gray-400">{t("online.shop.usable")}</dt>
        <dd className="text-right">
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-heading text-xs font-semibold uppercase tracking-wider ${
              usable === "now"
                ? "bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
                : "bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300"
            }`}
          >
            {usable !== "now" && <CalendarClock className="h-3 w-3" aria-hidden="true" />}
            {t(USABLE_KEY[usable])}
          </span>
        </dd>
        <dt className="text-gray-500 dark:text-gray-400">{t("online.shop.held")}</dt>
        <dd className="text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">
          {held}
        </dd>
      </dl>

      <div className="flex flex-col gap-2 border-t border-gray-200 pt-5 dark:border-navy-600">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-heading text-sm font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
            {t("online.shop.quantityLabel")}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center overflow-hidden rounded-lg border border-gray-300 dark:border-navy-600">
              <button
                type="button"
                className={stepButton}
                disabled={busy || (quantity ?? 0) <= 1}
                onClick={() => step(-1)}
                aria-label={t("online.shop.decrease")}
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <input
                type="text"
                inputMode="numeric"
                aria-label={t("online.shop.quantity", { max: most })}
                value={quantity === null ? "" : String(quantity)}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "");
                  pick(digits === "" ? null : Number(digits));
                }}
                className="h-11 w-12 bg-transparent text-center font-heading text-2xl font-bold tabular-nums text-gray-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 dark:text-gray-100"
              />
              <button
                type="button"
                className={stepButton}
                disabled={busy || (quantity ?? 0) >= most}
                onClick={() => step(1)}
                aria-label={t("online.shop.increase")}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={busy || preset > most}
                onClick={() => pick(preset)}
                aria-label={t("online.shop.presetAria", { n: preset })}
                aria-pressed={quantity === preset}
                className={`h-11 rounded-lg border px-3 font-heading text-sm font-semibold tracking-wider focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                  quantity === preset
                    ? "border-primary-500 text-primary-700 dark:border-primary-400 dark:text-primary-300"
                    : "border-gray-300 text-gray-700 hover:border-primary-500 dark:border-navy-600 dark:text-gray-300 dark:hover:border-primary-500"
                }`}
              >
                ×{preset}
              </button>
            ))}
          </div>
        </div>
        {most < MOST_AT_ONCE && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.shop.room", { max: most })}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 rounded-lg bg-gray-50 p-4 text-sm dark:bg-navy-900">
        <dt className="text-gray-500 dark:text-gray-400">{t("online.shop.price")}</dt>
        <dd className="text-right tabular-nums text-gray-700 dark:text-gray-300">
          {formatCoins(item.price, i18n.language)} × {quantity ?? 0}
        </dd>
        <dt className="text-gray-500 dark:text-gray-400">{t("online.shop.total")}</dt>
        <dd className="text-right font-heading text-3xl font-bold leading-none tabular-nums text-accent-600 dark:text-accent-400">
          {coinsText(total)}
        </dd>
        {balance !== undefined && (
          <>
            <dt className="text-gray-500 dark:text-gray-400">{t("online.shop.after")}</dt>
            <dd
              className={`text-right font-semibold tabular-nums ${
                tooDear ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"
              }`}
            >
              {tooDear ? t("online.shop.notEnough") : coinsText(balance - total)}
            </dd>
          </>
        )}
        <dt className="text-gray-500 dark:text-gray-400">{t("online.coins.priceListLabel")}</dt>
        <dd className="text-right tabular-nums text-gray-700 dark:text-gray-300">{version}</dd>
      </dl>

      <p className="text-xs text-gray-500 dark:text-gray-400">{t("online.shop.bound")}</p>
      {tooMany && (
        <p role="note" className="text-xs text-red-600 dark:text-red-400">
          {t("online.shop.room", { max: most })}
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

      <div className="flex flex-wrap gap-3">
        <FrameCancel onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </FrameCancel>
        <button type="button" disabled={!ready} onClick={confirm} className={FRAME_ACTION}>
          {t("online.shop.confirm")}
          <span className="ml-1 inline-flex items-center gap-1.5 text-xl tabular-nums text-accent-400">
            <Coins className="h-4.5 w-4.5" aria-hidden="true" />
            {formatCoins(total, i18n.language)}
          </span>
        </button>
      </div>
    </ItemDialogFrame>
  );
}
