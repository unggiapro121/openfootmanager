import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Coins, ShoppingBag, Sparkles } from "lucide-react";
import type { CoinLineView, CoinView } from "../../api";
import { formatCoins } from "../../format";
import { LABEL } from "../overview/OverviewCard";
import { todayTotals } from "./coinWallet";

/** The coin's own name: a brand, the same in every language (C-7 C7-5). */
export const COIN_NAME = "OFM Coin";

const GHOST_LINK =
  "inline-flex h-11 flex-[1_1_140px] items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 font-heading text-sm font-bold uppercase tracking-wider text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-navy-600 dark:text-gray-100 dark:hover:bg-navy-600 dark:focus:ring-offset-navy-800";

function Tile({ label, value, tone }: { label: string; value: string; tone: "in" | "out" }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 dark:border-navy-600 dark:bg-navy-900">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span
        className={`font-heading text-2xl font-bold tabular-nums ${
          tone === "in"
            ? "text-primary-700 dark:text-success-400"
            : "text-red-600 dark:text-red-400"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The balance (design vi-coin.html): the coins in gold (red below zero), what came in and went out
 * today from the lines read, and the ways to spend and earn them. `lines` is undefined until read.
 */
export default function BalanceCard({
  coins,
  lines,
}: {
  coins: CoinView;
  lines: CoinLineView[] | undefined;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const totals = lines ? todayTotals(lines, coins.nextDayAt) : undefined;
  const negative = coins.balance < 0;
  return (
    <section
      aria-labelledby={titleId}
      className="relative flex min-w-0 flex-[1_1_380px] flex-col gap-4.5 overflow-hidden rounded-2xl border border-t-4 border-gray-200 border-t-accent-400 bg-white px-5 py-6 shadow-lg @2xl:px-7 dark:border-navy-600 dark:border-t-accent-400 dark:bg-navy-800"
    >
      <Coins
        aria-hidden="true"
        strokeWidth={0.6}
        className="pointer-events-none absolute -right-10 -top-10 hidden h-64 w-64 text-accent-400 opacity-10 @xl:block"
      />
      <h2 id={titleId} className={`relative ${LABEL}`}>
        {t("online.coins.balanceOf", { name: COIN_NAME })}
      </h2>
      <div className="relative flex items-center gap-3.5">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-accent-500 bg-accent-100 text-accent-700 dark:border-accent-400 dark:bg-accent-900/40 dark:text-accent-400">
          <Coins className="h-8 w-8" aria-hidden="true" />
        </span>
        <span
          className={`font-heading text-6xl font-bold leading-none tabular-nums ${
            negative ? "text-red-600 dark:text-red-400" : "text-accent-700 dark:text-accent-400"
          }`}
        >
          {formatCoins(coins.balance, i18n.language)}
        </span>
      </div>
      <div className="relative grid grid-cols-2 gap-3">
        <Tile
          label={t("online.coins.todayIn")}
          tone="in"
          value={totals ? `+${formatCoins(totals.in, i18n.language)}` : "—"}
        />
        <Tile
          label={t("online.coins.todayOut")}
          tone="out"
          value={totals ? `−${formatCoins(totals.out, i18n.language)}` : "—"}
        />
      </div>
      <div className="relative mt-auto flex flex-wrap gap-2.5">
        <Link to="/online/shop" className={GHOST_LINK}>
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />
          {t("online.coins.toShop")}
        </Link>
        <Link to="/online/events" className={GHOST_LINK}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t("online.coins.toEvents")}
        </Link>
      </div>
    </section>
  );
}
