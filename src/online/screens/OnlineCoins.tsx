import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Coins, Lock, AlertTriangle } from "lucide-react";
import DashboardModalFrame from "../../components/dashboard/DashboardModalFrame";
import { Button, Card, CardBody, CardHeader } from "../../components/ui";
import { formatDate } from "../../lib/dateFormatting";
import { formatExactMoney } from "../../lib/valueFormatting";
import type { CoinLineView, CoinView } from "../api";
import { online } from "../client";
import { OnlineApiError } from "../errors";
import { formatCoins, formatMoment } from "../format";
import { refreshCoins, refreshFinance, tracked, useOnlineStore } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";
import { marketErrorText } from "./market/marketText";
import MoneyInput from "./market/MoneyInput";
import ResourceState from "./ResourceState";
import { useActionKey } from "./useActionKey";

/** The coin's own name: a brand, the same in every language (C-7 C7-5). */
const COIN_NAME = "OFM Coin";
/** Coin lines read a page at a time. */
const LINES_PAGE = 30;

const PRICE_CHANGED = "be.error.economy.priceChanged";
const LIMIT_REACHED = "be.error.economy.exchangeLimitReached";

/** Why the coins cannot be spent, each said apart (C-7 §4.1): below zero, and locked. */
function standing(coins: CoinView): { negative: boolean; locked: boolean; maybeLocked: boolean } {
  const negative = coins.balance < 0;
  // An older server has no `coinLocked`: `blocked` with coins at or above zero can only be the
  // lock, and below zero it may be both (R15-1).
  if (typeof coins.coinLocked === "boolean") {
    return { negative, locked: coins.coinLocked, maybeLocked: false };
  }
  return {
    negative,
    locked: coins.blocked && !negative,
    maybeLocked: coins.blocked && negative,
  };
}

/** The coins left to exchange today; every coin when the price list sets no daily cap. */
function leftToday(coins: CoinView): number | undefined {
  if (coins.exchangeDailyLimit === undefined) return undefined;
  return Math.max(0, coins.exchangeDailyLimit - coins.exchangedToday);
}

/**
 * The coach's OFM Coins (C-7a1, C7-8): the balance, why it cannot be spent, an exchange into the
 * club's money at the price list in force, and the lines. Coins belong to the person, so the page
 * opens without a club. Every number but the preview is the server's.
 */
export default function OnlineCoins() {
  const { t } = useTranslation();
  const coins = useOnlineStore((state) => state.coins);
  const hasClub = useOnlineStore((state) => Boolean(state.club));
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    refreshCoins().catch(setLoadError);
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (hasClub) void refreshFinance().catch(() => undefined);
  }, [hasClub]);

  if (coins === undefined) {
    return (
      <ResourceState
        resource={loadError ? { status: "failed", error: loadError } : { status: "loading" }}
        reload={load}
      >
        {() => null}
      </ResourceState>
    );
  }
  if (coins === null) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.coins.notOnServer")}</p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-3 empty:hidden">
        <Banners coins={coins} />
      </div>
      <Balance coins={coins} />
      <Exchange coins={coins} />
      <Lines />
    </div>
  );
}

function Banners({ coins }: { coins: CoinView }) {
  const { t, i18n } = useTranslation();
  const { negative, locked, maybeLocked } = standing(coins);
  return (
    <>
      {negative && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-accent-400/50 bg-accent-50 px-4 py-3 text-sm text-gray-800 dark:bg-accent-500/10 dark:text-gray-100"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400"
            aria-hidden="true"
          />
          <span>
            {t("online.coins.negative", { balance: formatCoins(coins.balance, i18n.language) })}
            {maybeLocked && ` ${t("online.coins.maybeLocked")}`}
          </span>
        </p>
      )}
      {locked && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("online.coins.locked")}
        </p>
      )}
    </>
  );
}

function Balance({ coins }: { coins: CoinView }) {
  const { t, i18n } = useTranslation();
  return (
    <Card accent="accent">
      <CardHeader>{t("online.coins.balance")}</CardHeader>
      <CardBody>
        <div className="flex items-center justify-center gap-3 py-2">
          <Coins className="h-8 w-8 text-accent-500 dark:text-accent-400" aria-hidden="true" />
          <p
            className={`font-heading text-4xl font-bold tabular-nums ${
              coins.balance < 0
                ? "text-red-600 dark:text-red-400"
                : "text-gray-900 dark:text-gray-100"
            }`}
          >
            {formatCoins(coins.balance, i18n.language)}
          </p>
        </div>
        <p className="text-center font-heading text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {COIN_NAME}
        </p>
      </CardBody>
    </Card>
  );
}

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

function Exchange({ coins }: { coins: CoinView }) {
  const { t, i18n } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  const [amount, setAmount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const refusal = useRefusal(coins, amount);

  if (coins.priceListVersion === undefined || coins.cashPerCoin === undefined) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>{t("online.coins.exchange")}</CardHeader>
        <CardBody>
          <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.coins.closed")}</p>
        </CardBody>
      </Card>
    );
  }
  const rate = coins.cashPerCoin;
  const left = leftToday(coins);
  const all = Math.max(0, Math.min(coins.balance, left ?? coins.balance));
  const ready = amount !== null && amount >= 1 && refusal === null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>{t("online.coins.exchange")}</CardHeader>
      <CardBody>
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>
            {t("online.coins.rate", { cash: formatExactMoney(rate) })}
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
              {t("online.coins.priceList", { version: coins.priceListVersion })}
            </span>
          </p>
          {left !== undefined && coins.exchangeDailyLimit !== undefined && (
            <p>
              {t("online.coins.today", {
                left: formatCoins(left, i18n.language),
                limit: formatCoins(coins.exchangeDailyLimit, i18n.language),
                time: formatMoment(coins.nextDayAt, i18n.language),
              })}
            </p>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <MoneyInput
                label={t("online.coins.amount")}
                value={amount}
                onChange={(value) => {
                  setDone(null);
                  setAmount(value);
                }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={all < 1}
              onClick={() => setAmount(all)}
            >
              {t("online.coins.all")}
            </Button>
          </div>
          {club && amount !== null && amount >= 1 && (
            <p>
              {t("online.coins.preview", {
                club: club.club.name,
                cash: formatExactMoney(amount * rate),
              })}
            </p>
          )}
          {refusal && (
            <p role="note" className="text-xs text-red-600 dark:text-red-400">
              {refusal}
              {!club && (
                <>
                  {" "}
                  <Link to="/online/takeover" className="font-semibold underline">
                    {t("online.coins.takeOver")}
                  </Link>
                </>
              )}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={!ready}
              onClick={() => {
                setDone(null);
                setConfirming(true);
              }}
            >
              {t("online.coins.exchangeButton")}
            </Button>
          </div>
          {done && (
            <p role="status" className="text-sm text-green-700 dark:text-green-400">
              {done}
            </p>
          )}
        </div>
      </CardBody>
      {confirming && amount !== null && club && (
        <ExchangeDialog
          amount={amount}
          clubName={club.club.name}
          onClose={() => setConfirming(false)}
          onAmount={setAmount}
          onDone={(text) => {
            setConfirming(false);
            setAmount(null);
            setDone(text);
          }}
        />
      )}
    </Card>
  );
}

/**
 * The exchange asked once more (C-7 C7-6): it shows the price list it will send. A request that
 * got no answer is sent again under the same key; a changed price list is read again and shown,
 * and confirming it is a new request with a new key, never sent by itself.
 */
function ExchangeDialog({
  amount,
  clubName,
  onClose,
  onAmount,
  onDone,
}: {
  amount: number;
  clubName: string;
  onClose: () => void;
  onAmount: (amount: number) => void;
  onDone: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const coins = useOnlineStore((state) => state.coins);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();

  if (!coins || coins.priceListVersion === undefined || coins.cashPerCoin === undefined) {
    return null;
  }
  const version = coins.priceListVersion;
  const rate = coins.cashPerCoin;

  const confirm = () => {
    setBusy(true);
    setError(null);
    run((key) => tracked(() => online.coins.exchange(amount, version, key)), `${amount}@${version}`)
      .then((view) => {
        useOnlineStore.setState((state) => ({
          coins: state.coins ? { ...state.coins, balance: view.coinBalance } : state.coins,
          finance: state.finance ? { ...state.finance, cash: view.clubCash } : state.finance,
        }));
        void refreshCoins().catch(() => undefined);
        void refreshFinance().catch(() => undefined);
        onDone(
          t("online.coins.exchanged", {
            coins: formatCoins(view.coins, i18n.language),
            cash: formatExactMoney(view.cash),
          }),
        );
      })
      .catch((failure: unknown) => {
        setError(failure);
        if (failure instanceof OnlineApiError) {
          if (failure.code === LIMIT_REACHED && typeof failure.params.remaining === "number") {
            onAmount(failure.params.remaining);
          }
          if (failure.status !== 0) void refreshCoins().catch(() => undefined);
        }
      })
      .finally(() => setBusy(false));
  };

  const priceChanged = error instanceof OnlineApiError && error.code === PRICE_CHANGED;
  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coin-exchange-title"
        className="space-y-4"
      >
        <h3
          id="coin-exchange-title"
          className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
        >
          {t("online.coins.confirmTitle")}
        </h3>
        <dl className="grid grid-cols-2 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
          <dt>{t("online.coins.amount")}</dt>
          <dd className="text-right tabular-nums">{formatCoins(amount, i18n.language)}</dd>
          <dt>{t("online.coins.rateLabel")}</dt>
          <dd className="text-right tabular-nums">{formatExactMoney(rate)}</dd>
          <dt>{t("online.coins.priceListLabel")}</dt>
          <dd className="text-right tabular-nums">{version}</dd>
          <dt>{t("online.coins.clubLabel")}</dt>
          <dd className="text-right">{clubName}</dd>
          <dt>{t("online.coins.cashLabel")}</dt>
          <dd className="text-right font-semibold tabular-nums">
            {formatExactMoney(amount * rate)}
          </dd>
        </dl>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t("online.coins.oneWay")}</p>
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {marketErrorText(t, i18n.language, error)}
            {priceChanged && ` ${t("online.coins.reviewPrices")}`}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={confirm}>
            {t("online.coins.confirm")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}

function signedClass(amount: number): string {
  return amount < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400";
}

function Lines() {
  const { t, i18n } = useTranslation();
  const [lines, setLines] = useState<CoinLineView[]>([]);
  const [next, setNext] = useState<number | undefined>(undefined);
  const [moreError, setMoreError] = useState<unknown>(null);
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.coins.ledger(undefined, LINES_PAGE)),
    [],
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
        setLines((shown) => [...shown, ...page.items]);
        setNext(page.nextCursor);
      })
      .catch(setMoreError);
  };

  return (
    <Card className="lg:col-span-3">
      <CardHeader>{t("online.coins.lines")}</CardHeader>
      <CardBody className="p-0">
        <ResourceState resource={resource} reload={reload}>
          {() =>
            lines.length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
                {t("online.coins.linesEmpty")}
              </p>
            ) : (
              <ol
                aria-label={t("online.coins.lines")}
                className="flex flex-col divide-y divide-gray-100 dark:divide-navy-600"
              >
                {lines.map((line) => (
                  <li key={line.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="w-32 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(line.at, i18n.language, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="min-w-0 flex-1 text-gray-700 dark:text-gray-200">
                      {t(`online.coins.kind.${line.kind}`, { defaultValue: line.kind })}
                    </span>
                    <span className={`font-medium tabular-nums ${signedClass(line.amount)}`}>
                      {line.amount > 0 ? "+" : ""}
                      {formatCoins(line.amount, i18n.language)}
                    </span>
                  </li>
                ))}
              </ol>
            )
          }
        </ResourceState>
        {next !== undefined && (
          <div className="border-t border-gray-100 px-5 py-3 dark:border-navy-600">
            <Button size="sm" variant="outline" onClick={more}>
              {t("online.coins.more")}
            </Button>
          </div>
        )}
        {moreError !== null && (
          <p role="alert" className="px-5 pb-3 text-sm text-red-600 dark:text-red-400">
            {marketErrorText(t, i18n.language, moreError)}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
