import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { ArrowRightLeft, Coins, Gift, ShoppingBag } from "lucide-react";
import { formatDate } from "../../../lib/dateFormatting";
import type { CoinLineView } from "../../api";
import { useOnlineNow } from "../../clock";
import { online } from "../../client";
import { formatCoins } from "../../format";
import { tracked } from "../../store/onlineStore";
import { type OnlineResource, useOnlineResource } from "../../useOnlineResource";
import { marketErrorText } from "../market/marketText";
import ResourceState from "../ResourceState";
import { balancesAfter, groupByDay, type LineTone, lineTone, todayKey } from "./coinWallet";

/** Coin lines read a page at a time. */
const LINES_PAGE = 30;

export interface CoinLines {
  resource: OnlineResource<unknown>;
  reload: () => void;
  /** The lines read so far, newest first; undefined until the first page came. */
  lines: CoinLineView[] | undefined;
  hasMore: boolean;
  more: () => void;
  moreError: unknown;
}

/**
 * The coin lines, a page at a time, read again whenever the balance changes: an exchange, a
 * purchase or a ring moved it, and the balance after each line walks back from it.
 */
export function useCoinLines(balance: number): CoinLines {
  const [lines, setLines] = useState<CoinLineView[] | undefined>(undefined);
  const [next, setNext] = useState<number | undefined>(undefined);
  const [moreError, setMoreError] = useState<unknown>(null);
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.coins.ledger(undefined, LINES_PAGE)),
    [balance],
  );

  useEffect(() => {
    if (resource.status !== "ready") return;
    setLines(resource.data.items);
    setNext(resource.data.nextCursor);
  }, [resource]);

  const more = () => {
    if (next === undefined) return;
    setMoreError(null);
    tracked(() => online.coins.ledger(next, LINES_PAGE))
      .then((page) => {
        setLines((shown) => [...(shown ?? []), ...page.items]);
        setNext(page.nextCursor);
      })
      .catch(setMoreError);
  };

  return { resource, reload, lines, hasMore: next !== undefined, more, moreError };
}

type Filter = "all" | "in" | "out";
const FILTERS: Filter[] = ["all", "in", "out"];

function passes(filter: Filter, line: CoinLineView): boolean {
  if (filter === "in") return line.amount > 0;
  if (filter === "out") return line.amount < 0;
  return true;
}

const TONE: Record<LineTone, { icon: LucideIcon; className: string }> = {
  event: {
    icon: Gift,
    className: "bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300",
  },
  shop: {
    icon: ShoppingBag,
    className: "bg-gray-100 text-gray-700 dark:bg-navy-600 dark:text-gray-300",
  },
  exchange: {
    icon: ArrowRightLeft,
    className: "bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300",
  },
  other: {
    icon: Coins,
    className: "bg-gray-100 text-gray-700 dark:bg-navy-600 dark:text-gray-300",
  },
};

function LineRow({ line, after }: { line: CoinLineView; after: number }) {
  const { t, i18n } = useTranslation();
  const tone = TONE[lineTone(line.kind)];
  const Icon = tone.icon;
  const time = Number.isNaN(Date.parse(line.at))
    ? ""
    : new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(
        new Date(line.at),
      );
  return (
    <li className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-lg px-3 py-2.5 hover:bg-gray-50 @xl:grid-cols-[40px_minmax(0,1fr)_auto_110px] dark:hover:bg-navy-600/40">
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone.className}`}
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
          {t(`online.coins.kind.${line.kind}`, { defaultValue: line.kind })}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{time}</span>
      </span>
      <span
        className={`text-right font-heading text-xl font-bold tabular-nums ${
          line.amount < 0
            ? "text-red-600 dark:text-red-400"
            : "text-primary-700 dark:text-success-400"
        }`}
      >
        {line.amount > 0 ? "+" : line.amount < 0 ? "−" : ""}
        {formatCoins(Math.abs(line.amount), i18n.language)}
      </span>
      <span className="hidden text-right text-sm tabular-nums text-gray-600 @xl:block dark:text-gray-400">
        <span className="sr-only">{t("online.coins.balanceAfter")} </span>
        {formatCoins(after, i18n.language)}
      </span>
    </li>
  );
}

/**
 * The coin history (design vi-coin.html): what came in and went out, by day, each line with the
 * balance after it, filtered to all, in or out, a page more on demand.
 */
export default function CoinHistory({ balance, history }: { balance: number; history: CoinLines }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const now = useOnlineNow();
  const [filter, setFilter] = useState<Filter>("all");
  const lines = history.lines ?? [];
  const after = balancesAfter(balance, lines);
  const afterById = new Map(lines.map((line, index) => [line.id, after[index]]));
  const shown = lines.filter((line) => passes(filter, line));
  const today = todayKey(now);

  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md dark:border-navy-600 dark:bg-navy-700"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 @2xl:px-6 dark:border-navy-600">
        <h2
          id={titleId}
          className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {t("online.coins.lines")}
        </h2>
        <fieldset
          aria-label={t("online.coins.filter.label")}
          className="inline-flex min-w-0 gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-navy-600 dark:bg-navy-800"
        >
          {FILTERS.map((one) => (
            <button
              key={one}
              type="button"
              aria-pressed={filter === one}
              onClick={() => setFilter(one)}
              className={`h-8 rounded-md px-3 font-heading text-sm font-semibold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                filter === one
                  ? "bg-primary-700 text-white"
                  : "text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-navy-600"
              }`}
            >
              {t(`online.coins.filter.${one}`)} ({lines.filter((line) => passes(one, line)).length})
            </button>
          ))}
        </fieldset>
      </div>
      <div className="px-3 pb-3 pt-2">
        <ResourceState resource={history.resource} reload={history.reload}>
          {() =>
            lines.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                {t("online.coins.linesEmpty")}
              </p>
            ) : shown.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                {t("online.coins.filter.none")}
              </p>
            ) : (
              groupByDay(shown).map((day, place) => {
                const date = formatDate(day.at, i18n.language, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                });
                const name = day.key === today ? t("online.coins.todayDate", { date }) : date;
                return (
                  <div key={day.key}>
                    <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5">
                      <h3 className="font-heading text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                        {name}
                      </h3>
                      {place === 0 && (
                        <span className="hidden text-xs text-gray-500 @xl:block dark:text-gray-400">
                          {t("online.coins.balanceAfter")}
                        </span>
                      )}
                    </div>
                    <ol aria-label={name}>
                      {day.lines.map((line) => (
                        <LineRow key={line.id} line={line} after={afterById.get(line.id) ?? 0} />
                      ))}
                    </ol>
                  </div>
                );
              })
            )
          }
        </ResourceState>
        {history.hasMore && (
          <div className="px-3 pt-2">
            <button
              type="button"
              onClick={history.more}
              className="h-9 rounded-lg border border-gray-300 px-4 font-heading text-sm font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-navy-600 dark:text-gray-200 dark:hover:bg-navy-600 dark:focus:ring-offset-navy-700"
            >
              {t("online.coins.more")}
            </button>
          </div>
        )}
        {history.moreError !== null && (
          <p role="alert" className="px-3 pt-2 text-sm text-red-600 dark:text-red-400">
            {marketErrorText(t, i18n.language, history.moreError)}
          </p>
        )}
      </div>
    </section>
  );
}
