import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Coins, Info, Plus } from "lucide-react";
import type { CoinView, SeasonNowView, ShopItemView } from "../../api";
import { formatCoins } from "../../format";
import { ItemIcon } from "./itemLook";
import { itemName, scopeText } from "./itemText";

const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-navy-800";

/**
 * The shop's balance card on a phone (m-cua-hang): the balance and its price list, a top-up
 * button that stays off while coins are not sold (DM-3, D-S1, D-S11), and under them the season's
 * word on bought items, folded (D-S5). The wallet is the app bar's coin chip.
 */
export function PhoneShopHead({
  coins,
  season,
  version,
}: {
  coins: CoinView | null | undefined;
  season: SeasonNowView | null | undefined;
  version: number;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const noteId = useId();
  const over = season?.status === "closing" || season?.status === "closed";
  const soon = season?.status === "scheduled";
  const seasonal = over || soon;
  const folded = over
    ? t("online.shop.noteOver", { number: season.number })
    : soon
      ? t("online.shop.noteSoon", { number: season.number })
      : t("online.shop.noteOpen");
  const negative = coins !== null && coins !== undefined && coins.balance < 0;
  const tint = seasonal
    ? "bg-accent-50 text-accent-800 dark:bg-accent-900/20 dark:text-accent-300"
    : "text-gray-500 dark:text-gray-400";
  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-accent-50 to-white to-55% dark:border-navy-600 dark:from-accent-900/30 dark:to-navy-700"
    >
      <div className="flex items-center gap-3 p-3.5">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-400"
        >
          <Coins className="h-5.5 w-5.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span id={titleId} className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.shop.balance")}
          </span>
          <span
            className={`font-heading text-3xl font-bold leading-none tabular-nums ${
              negative ? "text-red-600 dark:text-red-400" : "text-accent-700 dark:text-accent-400"
            }`}
          >
            {coins ? formatCoins(coins.balance, i18n.language) : "—"}
          </span>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("online.coins.priceList", { version })}
          </span>
        </span>
        {/* Off, with nowhere to go, until coins are sold (DM-3): no link out of the app. */}
        <button
          type="button"
          aria-disabled="true"
          aria-label={t("online.shop.topUpSoon")}
          className={`inline-flex h-10 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg border border-accent-600 px-3.5 font-heading text-sm font-bold uppercase tracking-wider text-accent-700 opacity-50 dark:border-accent-400 dark:text-accent-400 ${FOCUS}`}
        >
          {t("online.shop.topUp")}
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={noteId}
        onClick={() => setOpen(!open)}
        className={`flex min-h-11 w-full items-center gap-2 border-t border-gray-200 px-3.5 py-2.5 text-left text-xs font-semibold dark:border-navy-600 ${tint} ${FOCUS}`}
      >
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">{folded}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <p
          id={noteId}
          className={`px-3.5 pb-3 text-xs leading-relaxed text-gray-700 dark:text-gray-300 ${
            seasonal ? "bg-accent-50 dark:bg-accent-900/20" : ""
          }`}
        >
          {seasonal && (
            <>
              <span>
                {t(over ? "online.shop.seasonOverText" : "online.shop.seasonSoonText")}
              </span>{" "}
            </>
          )}
          <span>{t("online.shop.neverExpire")}</span>
        </p>
      )}
    </section>
  );
}

/**
 * An item's card on a phone (m-cua-hang): icon and stock, the name on two lines at most, what it
 * is used on in one line, and the price button. One that cannot be bought is dimmed, with the
 * reason left clear beside the button (D-S6).
 */
export function PhoneOffer({
  item,
  blocker,
  held,
  onBuy,
}: {
  item: ShopItemView;
  blocker: string | null;
  held: number;
  onBuy: () => void;
}) {
  const { t, i18n } = useTranslation();
  const reasonId = useId();
  const name = itemName(t, item.itemCode);
  const scope = scopeText(t, item.itemCode);
  const price = formatCoins(item.price, i18n.language);
  const dim = blocker ? "opacity-50" : "";
  return (
    <article
      aria-label={name}
      data-blocked={blocker ? "true" : undefined}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-navy-600 dark:bg-navy-700"
    >
      <div className={`flex items-start justify-between gap-1.5 ${dim}`}>
        <ItemIcon code={item.itemCode} size="md" />
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {t("online.shop.heldShort")}{" "}
          <strong className="tabular-nums text-gray-900 dark:text-white">{held}</strong>
        </span>
      </div>
      <h3
        className={`line-clamp-2 min-h-9 text-sm font-semibold leading-snug text-gray-900 dark:text-white ${dim}`}
      >
        {name}
      </h3>
      {scope && (
        <span className={`truncate text-[11px] text-gray-500 dark:text-gray-400 ${dim}`}>
          {scope}
        </span>
      )}
      {blocker && (
        <p
          role="note"
          id={reasonId}
          className="flex items-start gap-1 text-[11px] leading-snug text-accent-700 dark:text-accent-300"
        >
          <Info className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2">{blocker}</span>
        </p>
      )}
      <button
        type="button"
        disabled={blocker !== null}
        onClick={onBuy}
        aria-label={t("online.shop.buyAria", { item: name, coins: price })}
        aria-describedby={blocker ? reasonId : undefined}
        className="mt-auto inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-primary-700 font-heading text-lg font-bold tabular-nums text-accent-400 hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary-700 dark:focus:ring-offset-navy-800"
      >
        <Coins className="h-4 w-4" aria-hidden="true" />
        {price}
      </button>
    </article>
  );
}
