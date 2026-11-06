import { useTranslation } from "react-i18next";
import { CalendarClock, Check, Minus, Plus } from "lucide-react";
import type { ShopItemView } from "../../api";
import { formatCoins } from "../../format";
import { lookOf } from "./itemLook";
import { itemDescription, scopeText } from "./itemText";

/** The most of one item bought at once when an older server sends no `maxPurchase`. */
export const MOST_AT_ONCE = 99;
/** Quick picks beside the stepper (design cua-hang.html). */
const PRESETS = [5, 10];

/** When a bought item can be used, as the dialog says it. */
export type Usable = "now" | "nextSeason" | "seasonStart";

const USABLE_KEY: Record<Usable, string> = {
  now: "online.shop.usableNow",
  nextSeason: "online.shop.usableNextSeason",
  seasonStart: "online.shop.usableSeasonStart",
};

/** What the purchase dialog's body shows: the item, and the quantity being picked. */
export interface PurchaseBody {
  item: ShopItemView;
  usable: Usable;
  held: number;
  effects: string[];
  caps: string[];
  descriptionId: string;
  quantity: number | null;
  most: number;
  tooMany: boolean;
  total: number;
  balance: number | undefined;
  tooDear: boolean;
  version: number;
  busy: boolean;
  pick: (value: number | null) => void;
  step: (by: number) => void;
}

const STEP_BUTTON =
  "flex h-11 w-11 items-center justify-center text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-navy-600";

/** The quantity: − and + around the number, then the quick picks. */
function QuantityPicker({ body, phone }: { body: PurchaseBody; phone: boolean }) {
  const { t } = useTranslation();
  const { quantity, most, busy, pick, step } = body;
  return (
    <div className="flex flex-wrap items-center gap-2 max-md:flex-nowrap max-md:gap-1.5">
      <div
        className={`inline-flex items-center overflow-hidden rounded-lg border border-gray-300 dark:border-navy-600 ${
          phone ? "bg-gray-50 dark:bg-navy-900" : ""
        }`}
      >
        <button
          type="button"
          className={STEP_BUTTON}
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
          className="h-11 w-12 bg-transparent text-center font-heading text-2xl font-bold tabular-nums text-gray-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 max-md:w-10 max-md:text-xl dark:text-gray-100"
        />
        <button
          type="button"
          className={STEP_BUTTON}
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
          className={`h-11 rounded-lg border px-3 font-heading text-sm font-semibold tracking-wider focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 max-md:min-w-11 max-md:px-2 ${
            quantity === preset
              ? "border-primary-500 text-primary-700 dark:border-primary-400 dark:text-primary-300"
              : "border-gray-300 text-gray-700 hover:border-primary-500 dark:border-navy-600 dark:text-gray-300 dark:hover:border-primary-500"
          }`}
        >
          ×{preset}
        </button>
      ))}
    </div>
  );
}

/**
 * How many more fit, under the quantity. On a phone the one line turns red when the number typed
 * is over it (D-S5); the desktop says that apart, under the sum.
 */
function RoomLine({ body, warns }: { body: PurchaseBody; warns: boolean }) {
  const { t } = useTranslation();
  if (body.most >= MOST_AT_ONCE) return null;
  const red = warns && body.tooMany;
  return (
    <p
      role={red ? "note" : undefined}
      className={`text-xs ${red ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}
    >
      {t("online.shop.room", { max: body.most })}
    </p>
  );
}

/** The desktop dialog's body (design cua-hang.html): the effect, the facts, the quantity, the sum. */
export function DesktopPurchaseBody({ body }: { body: PurchaseBody }) {
  const { t, i18n } = useTranslation();
  const { item, usable, held, effects, caps, descriptionId, quantity, total, balance } = body;
  const look = lookOf(item.itemCode);
  const coinsText = (amount: number) =>
    t("online.shop.coinsAmount", { coins: formatCoins(amount, i18n.language) });
  return (
    <>
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
          <QuantityPicker body={body} phone={false} />
        </div>
        <RoomLine body={body} warns={false} />
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
                body.tooDear ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"
              }`}
            >
              {body.tooDear ? t("online.shop.notEnough") : coinsText(balance - total)}
            </dd>
          </>
        )}
        <dt className="text-gray-500 dark:text-gray-400">{t("online.coins.priceListLabel")}</dt>
        <dd className="text-right tabular-nums text-gray-700 dark:text-gray-300">{body.version}</dd>
      </dl>

      <p className="text-xs text-gray-500 dark:text-gray-400">{t("online.shop.bound")}</p>
      {body.tooMany && (
        <p role="note" className="text-xs text-red-600 dark:text-red-400">
          {t("online.shop.room", { max: body.most })}
        </p>
      )}
    </>
  );
}

/**
 * The phone sheet's body (m-cua-hang, D-S5, D-S7): what it does in one box with its limits, the
 * three facts side by side, the quantity with its room, and the binding note last.
 */
export function PhonePurchaseBody({ body }: { body: PurchaseBody }) {
  const { t } = useTranslation();
  const { item, usable, held, effects, caps, descriptionId } = body;
  const fact = "text-[13px] font-semibold text-gray-900 dark:text-white";
  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-navy-600 dark:bg-navy-900">
        <p id={descriptionId} className="text-sm leading-snug text-gray-700 dark:text-gray-200">
          {itemDescription(t, item.itemCode)}
        </p>
        {effects.map((line) => (
          <span
            key={line}
            className="self-start rounded-md bg-primary-50 px-2 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
          >
            {line}
          </span>
        ))}
        {caps.map((line) => (
          <span key={line} className="text-xs text-gray-500 dark:text-gray-400">
            {line}
          </span>
        ))}
      </div>
      <dl className="grid grid-cols-3 gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("online.shop.appliesTo")}
          </dt>
          <dd className={fact}>{scopeText(t, item.itemCode) ?? "—"}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("online.shop.usable")}
          </dt>
          <dd
            className={`text-[13px] font-semibold ${
              usable === "now"
                ? "text-primary-700 dark:text-primary-300"
                : "text-accent-700 dark:text-accent-300"
            }`}
          >
            {t(USABLE_KEY[usable])}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11px] text-gray-500 dark:text-gray-400">{t("online.shop.held")}</dt>
          <dd className={`${fact} tabular-nums`}>{held}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
            {t("online.shop.quantityLabel")}
          </span>
          <QuantityPicker body={body} phone />
        </div>
        <RoomLine body={body} warns />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{t("online.shop.bound")}</p>
    </>
  );
}

/** The phone sheet's foot line: the price times the quantity, and what is left after (D-S2). */
export function PhonePurchaseSummary({ body }: { body: PurchaseBody }) {
  const { t, i18n } = useTranslation();
  const { item, quantity, balance, total, tooDear } = body;
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
      <span className="tabular-nums">
        {formatCoins(item.price, i18n.language)} × {quantity ?? 0}
      </span>
      {balance !== undefined && (
        <span>
          {t("online.shop.leftLabel")}{" "}
          <strong
            className={`tabular-nums ${tooDear ? "text-red-600 dark:text-red-400" : "text-accent-700 dark:text-accent-400"}`}
          >
            {tooDear ? t("online.shop.notEnough") : formatCoins(balance - total, i18n.language)}
          </strong>
        </span>
      )}
    </div>
  );
}
