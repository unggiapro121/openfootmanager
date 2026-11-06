import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRightLeft } from "lucide-react";
import { formatExactMoney } from "../../../lib/valueFormatting";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { formatCoins } from "../../format";
import { refreshCoins, refreshFinance, tracked, useOnlineStore } from "../../store/onlineStore";
import ItemDialogFrame, { FRAME_ACTION, FrameButtons, FrameCancel } from "../items/ItemDialogFrame";
import { marketErrorText } from "../market/marketText";
import { useActionKey } from "../useActionKey";

const PRICE_CHANGED = "be.error.economy.priceChanged";
export const LIMIT_REACHED = "be.error.economy.exchangeLimitReached";

const ignore = () => undefined;

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-gray-600 dark:text-gray-400">{label}</dt>
      <dd
        className={`text-right tabular-nums ${
          strong
            ? "font-heading text-xl font-bold text-primary-700 dark:text-primary-400"
            : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The exchange asked once more (C-7 C7-6): it shows the price list it will send. A request that
 * got no answer is sent again under the same key; a changed price list is read again and shown,
 * and confirming it is a new request with a new key, never sent by itself.
 */
export default function ExchangeDialog({
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
        void refreshCoins().catch(ignore);
        void refreshFinance().catch(ignore);
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
          if (failure.status !== 0) void refreshCoins().catch(ignore);
        }
      })
      .finally(() => setBusy(false));
  };

  const priceChanged = error instanceof OnlineApiError && error.code === PRICE_CHANGED;
  return (
    <ItemDialogFrame
      icon={
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-400">
          <ArrowRightLeft className="h-7 w-7" aria-hidden="true" />
        </span>
      }
      title={t("online.coins.confirmTitle")}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {error !== null && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {marketErrorText(t, i18n.language, error)}
              {priceChanged && ` ${t("online.coins.reviewPrices")}`}
            </p>
          )}
          <FrameButtons>
            <FrameCancel onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </FrameCancel>
            <button type="button" className={FRAME_ACTION} disabled={busy} onClick={confirm}>
              {t("online.coins.confirm")}
            </button>
          </FrameButtons>
        </>
      }
    >
      <dl className="divide-y divide-gray-100 text-sm dark:divide-navy-600">
        <Row label={t("online.coins.amount")} value={formatCoins(amount, i18n.language)} />
        <Row label={t("online.coins.rateLabel")} value={formatExactMoney(rate)} />
        <Row label={t("online.coins.priceListLabel")} value={String(version)} />
        <Row label={t("online.coins.clubLabel")} value={clubName} />
        <Row label={t("online.coins.cashLabel")} value={formatExactMoney(amount * rate)} strong />
      </dl>
      <p className="text-xs text-gray-500 dark:text-gray-400">{t("online.coins.oneWay")}</p>
    </ItemDialogFrame>
  );
}
