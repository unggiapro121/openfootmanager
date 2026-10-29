import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowRightLeft, Coins, Hourglass, Wallet } from "lucide-react";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { CoinView } from "../../api";
import { formatCoins, formatMoment } from "../../format";
import { useOnlineStore } from "../../store/onlineStore";
import { useCountdownText } from "../useCountdownText";
import { exchangeMax, leftToday, standing } from "./coinWallet";
import ExchangeDialog, { LIMIT_REACHED } from "./ExchangeDialog";

/** The amounts one press away; the last is all that may go now. */
const PRESETS = [5, 10, 20];
/** The amount the form opens with, as the design does, within what may go. */
const FIRST_AMOUNT = 10;

/** Why the exchange cannot be asked now, in the order the coach would fix it; `null` when it can. */
function useRefusal(coins: CoinView, amount: number | null): string | null {
  const { t } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  const finance = useOnlineStore((state) => state.finance);
  const { negative, locked } = standing(coins);
  if (!club) return t("online.coins.needClub");
  if (finance && !finance.economy) return t("be.error.economy.disabled");
  if (finance?.locked) return t("be.error.economy.clubLocked");
  if (locked) return t("be.error.economy.coinLocked");
  if (negative) return t("be.error.economy.coinBalanceNegative");
  if (amount === null || amount < 1) return null;
  if (amount > coins.balance) return t("be.error.economy.insufficientCoin");
  const left = leftToday(coins);
  if (left !== undefined && amount > left) return t(LIMIT_REACHED, { remaining: left });
  return null;
}

function Frame({
  titleId,
  aside,
  children,
}: {
  titleId: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-[1.4_1_460px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md dark:border-navy-600 dark:bg-navy-700"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gradient-to-b from-white to-gray-50 px-5 py-4 @2xl:px-6 dark:border-navy-600 dark:from-navy-700 dark:to-navy-800">
        <h2
          id={titleId}
          className="flex items-center gap-2.5 font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          <ArrowRightLeft className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden />
          {t("online.coins.exchange")}
        </h2>
        {aside}
      </div>
      <div className="flex flex-1 flex-col gap-4.5 px-5 pb-6 pt-5 @2xl:px-6">{children}</div>
    </section>
  );
}

/** Today's cap: how much is left of it, and when it starts again. */
function Quota({ coins, left, limit }: { coins: CoinView; left: number; limit: number }) {
  const { t, i18n } = useTranslation();
  const countdown = useCountdownText(coins.nextDayAt) ?? "00:00:00";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
        <span>
          {t("online.coins.quotaLabel")}{" "}
          <strong className="tabular-nums text-gray-900 dark:text-white">
            {formatCoins(left, i18n.language)}/{formatCoins(limit, i18n.language)}
          </strong>
        </span>
        <span className="tabular-nums">
          {t("online.coins.resets", {
            time: formatMoment(coins.nextDayAt, i18n.language),
            countdown,
          })}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600"
      >
        <span
          className="block h-full rounded-full bg-primary-500"
          style={{ width: `${limit > 0 ? (left / limit) * 100 : 0}%` }}
        />
      </span>
    </div>
  );
}

function QuotaUsed({ coins, limit }: { coins: CoinView; limit: number }) {
  const { t, i18n } = useTranslation();
  const countdown = useCountdownText(coins.nextDayAt) ?? "00:00:00";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-center dark:border-navy-600 dark:bg-navy-900">
      <Hourglass className="h-7 w-7 text-gray-400 dark:text-gray-500" aria-hidden />
      <span className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-white">
        {t("online.coins.quotaUsed")}
      </span>
      <span className="text-sm text-gray-600 dark:text-gray-400">
        {t("online.coins.quotaBack", {
          countdown,
          limit: formatCoins(limit, i18n.language),
        })}
      </span>
    </div>
  );
}

function Preset({
  label,
  value,
  amount,
  max,
  onPick,
}: {
  label: string;
  value: number;
  amount: number | null;
  max: number;
  onPick: (value: number) => void;
}) {
  const on = amount === value && value > 0;
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={value < 1 || value > max}
      onClick={() => onPick(value)}
      className={`h-9 rounded-lg border px-3.5 font-heading text-sm font-bold tracking-wider focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:focus:ring-offset-navy-700 ${
        on
          ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
          : "border-gray-300 text-gray-700 hover:border-primary-500 dark:border-navy-600 dark:text-gray-300"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The exchange into the club's money (design vi-coin.html; C-7a1, C7-6, C7-8): the price list in
 * force, today's cap, the coins in and the money out, a few amounts one press away, and the
 * club's money after. Every refusal is said before asking; the confirmation asks once more.
 */
export default function ExchangePanel({ coins }: { coins: CoinView }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const inputId = useId();
  const club = useOnlineStore((state) => state.club);
  const finance = useOnlineStore((state) => state.finance);
  const max = exchangeMax(coins);
  const [amount, setAmount] = useState<number | null>(() =>
    max >= 1 ? Math.min(FIRST_AMOUNT, max) : null,
  );
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const refusal = useRefusal(coins, amount);

  if (coins.priceListVersion === undefined || coins.cashPerCoin === undefined) {
    return (
      <Frame titleId={titleId}>
        <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.coins.closed")}</p>
      </Frame>
    );
  }
  const rate = coins.cashPerCoin;
  const left = leftToday(coins);
  const limit = coins.exchangeDailyLimit;
  const asking = amount !== null && amount >= 1;
  const ready = asking && refusal === null;
  const pick = (value: number | null) => {
    setDone(null);
    setAmount(value);
  };

  return (
    <Frame
      titleId={titleId}
      aside={
        <span className="inline-flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          {t("online.coins.rate", { cash: formatExactMoney(rate) })}
          <span className="rounded-md bg-gray-100 px-1.5 py-px text-xs text-gray-600 dark:bg-navy-600 dark:text-gray-400">
            {t("online.coins.priceList", { version: coins.priceListVersion })}
          </span>
        </span>
      }
    >
      {left !== undefined && limit !== undefined && (
        <Quota coins={coins} left={left} limit={limit} />
      )}
      {left === 0 && limit !== undefined ? (
        <QuotaUsed coins={coins} limit={limit} />
      ) : (
        <>
          <div className="grid grid-cols-1 items-end gap-3 @xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={inputId} className="text-xs text-gray-600 dark:text-gray-400">
                {t("online.coins.amount")}
              </label>
              <span className="flex h-14 items-center gap-2 rounded-xl border border-gray-300 bg-gray-50 px-3.5 focus-within:ring-2 focus-within:ring-primary-500 dark:border-navy-600 dark:bg-navy-900">
                <Coins
                  className="h-5 w-5 shrink-0 text-accent-600 dark:text-accent-400"
                  aria-hidden
                />
                <input
                  id={inputId}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={max > 0 ? max : undefined}
                  value={amount ?? ""}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    pick(Number.isNaN(value) ? null : value);
                  }}
                  className="h-full min-w-0 flex-1 bg-transparent font-heading text-3xl font-bold tabular-nums text-accent-700 outline-none dark:text-accent-400"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("online.coins.unit")}
                </span>
              </span>
            </div>
            <span
              aria-hidden="true"
              className="mb-2 hidden h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-primary-600 @xl:flex dark:bg-navy-600 dark:text-primary-400"
            >
              <ArrowRight className="h-5 w-5" />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {t("online.coins.cashLabel")}
              </span>
              <span className="flex h-14 items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3.5 dark:border-primary-800 dark:bg-primary-900/20">
                <Wallet
                  className="h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400"
                  aria-hidden
                />
                <output
                  htmlFor={inputId}
                  className="truncate font-heading text-3xl font-bold tabular-nums text-primary-700 dark:text-primary-400"
                >
                  {formatExactMoney(asking ? amount * rate : 0)}
                </output>
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((value) => (
              <Preset
                key={value}
                label={formatCoins(value, i18n.language)}
                value={value}
                amount={amount}
                max={max}
                onPick={pick}
              />
            ))}
            <Preset
              label={t("online.coins.max", { coins: formatCoins(max, i18n.language) })}
              value={max}
              amount={amount}
              max={max}
              onPick={pick}
            />
          </div>
          {refusal && (
            <p role="note" className="text-sm text-red-600 dark:text-red-400">
              {refusal}
              {!club && (
                <>
                  {" "}
                  <Link
                    to="/online/takeover"
                    className="rounded font-semibold underline focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {t("online.coins.takeOver")}
                  </Link>
                </>
              )}
            </p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-4">
            {club && finance && (
              <span className="flex-[1_1_200px] text-sm text-gray-600 dark:text-gray-400">
                {t("online.coins.budgetAfter")}{" "}
                <strong className="tabular-nums text-gray-900 dark:text-white">
                  {formatExactMoney(finance.cash + (asking ? amount * rate : 0))}
                </strong>
              </span>
            )}
            <button
              type="button"
              disabled={!ready}
              onClick={() => {
                setDone(null);
                setConfirming(true);
              }}
              className="ml-auto h-12 flex-[0_1_240px] rounded-lg bg-primary-700 px-5 font-heading text-base font-bold uppercase tracking-wider text-white shadow-md hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary-700 dark:focus:ring-offset-navy-700"
            >
              {asking
                ? t("online.coins.exchangeCoins", { coins: formatCoins(amount, i18n.language) })
                : t("online.coins.exchangeButton")}
            </button>
          </div>
        </>
      )}
      {done && (
        <p role="status" className="text-sm text-primary-700 dark:text-primary-400">
          {done}
        </p>
      )}
      {confirming && amount !== null && club && (
        <ExchangeDialog
          amount={amount}
          clubName={club.club.name}
          onClose={() => setConfirming(false)}
          onAmount={setAmount}
          onDone={(text) => {
            setConfirming(false);
            const after = Math.max(0, max - amount);
            setAmount(after >= 1 ? Math.min(FIRST_AMOUNT, after) : null);
            setDone(text);
          }}
        />
      )}
    </Frame>
  );
}
