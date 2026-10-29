import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Lock } from "lucide-react";
import type { CoinView } from "../api";
import { formatCoins } from "../format";
import { refreshCoins, refreshFinance, useOnlineStore } from "../store/onlineStore";
import BalanceCard from "./coins/BalanceCard";
import CoinHistory, { useCoinLines } from "./coins/CoinHistory";
import { standing } from "./coins/coinWallet";
import ExchangePanel from "./coins/ExchangePanel";
import ResourceState from "./ResourceState";

/**
 * The coach's OFM Coins (design vi-coin.html; C-7a1, C7-8): why they cannot be spent, the balance
 * with today's ins and outs, an exchange into the club's money at the price list in force, and the
 * history. Coins belong to the person, so the page opens without a club. Every number but the
 * preview and the sums of the lines read is the server's.
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
  return <Wallet coins={coins} />;
}

function Wallet({ coins }: { coins: CoinView }) {
  const history = useCoinLines(coins.balance);
  return (
    // A container: the cards lay out by the room the page has beside the sidebar, not the window.
    <div className="@container flex flex-col gap-6">
      <Banners coins={coins} />
      <div className="flex flex-wrap items-stretch gap-6">
        <BalanceCard coins={coins} lines={history.lines} />
        <ExchangePanel coins={coins} />
      </div>
      <CoinHistory balance={coins.balance} history={history} />
    </div>
  );
}

function Banners({ coins }: { coins: CoinView }) {
  const { t, i18n } = useTranslation();
  const { negative, locked, maybeLocked } = standing(coins);
  if (!negative && !locked) return null;
  return (
    <div className="flex flex-col gap-3">
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
    </div>
  );
}
