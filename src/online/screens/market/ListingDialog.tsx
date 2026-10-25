import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
import { Button } from "../../../components/ui";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { ListingQuoteView } from "../../api";
import { online } from "../../client";
import { formatMoment } from "../../format";
import { refreshMarket, tracked } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";
import { marketErrorText, refusalText } from "./marketText";
import MoneyInput from "./MoneyInput";

/**
 * Putting one of the club's players up for auction (C-5 C5-9): the server's quote first, so the
 * band, the end and any reason it would be refused show before the coach confirms. The starting
 * price opens at the floor; the line under it says what the club keeps after the tax.
 */
export default function ListingDialog({
  playerId,
  playerName,
  onClose,
}: {
  playerId: string;
  playerName: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [quote, setQuote] = useState<ListingQuoteView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { run } = useActionKey();

  useEffect(() => {
    let live = true;
    tracked(() => online.market.quote(playerId))
      .then((answer) => {
        if (!live) return;
        setQuote(answer);
        setPrice(answer.minPrice ?? null);
      })
      .catch((failure: unknown) => live && setError(failure));
    return () => {
      live = false;
    };
  }, [playerId]);

  const min = quote?.minPrice;
  const max = quote?.maxPrice;
  const inBand =
    price !== null && min !== undefined && max !== undefined && price >= min && price <= max;
  const tax =
    price !== null && quote?.transferTaxPermille !== undefined
      ? Math.floor((price * quote.transferTaxPermille) / 1000)
      : 0;

  const list = () => {
    if (price === null) return;
    setBusy(true);
    setError(null);
    run((key) => tracked(() => online.market.list(playerId, price, key)), String(price))
      .then((auction) => {
        void refreshMarket().catch(() => undefined);
        navigate(`/online/auctions/${auction.id}`);
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div role="dialog" aria-modal="true" aria-labelledby="listing-title" className="space-y-4">
        <h3
          id="listing-title"
          className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
        >
          {t("online.market.listTitle", { player: playerName })}
        </h3>
        {quote === null && error === null && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>
        )}
        {quote?.refusal && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {refusalText(t, i18n.language, quote.refusal)}
          </p>
        )}
        {quote && !quote.refusal && min !== undefined && max !== undefined && (
          <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <dl className="grid grid-cols-2 gap-y-1">
              <dt>{t("online.market.value")}</dt>
              <dd className="text-right">{formatExactMoney(quote.marketValue ?? 0)}</dd>
              <dt>{t("online.market.band")}</dt>
              <dd className="text-right">
                {formatExactMoney(min)} – {formatExactMoney(max)}
              </dd>
              {quote.endsAt && (
                <>
                  <dt>{t("online.market.endsAt")}</dt>
                  <dd className="text-right">{formatMoment(quote.endsAt, i18n.language)}</dd>
                </>
              )}
            </dl>
            <MoneyInput label={t("online.market.startPrice")} value={price} onChange={setPrice} />
            {inBand ? (
              <p className="text-xs">
                {t("online.market.netAfterTax", {
                  net: formatExactMoney((price ?? 0) - tax),
                  rate: (quote.transferTaxPermille ?? 0) / 10,
                })}
              </p>
            ) : (
              <p className="text-xs text-red-600 dark:text-red-400">
                {t("online.market.problem.outOfBand", {
                  min: formatExactMoney(min),
                  max: formatExactMoney(max),
                })}
              </p>
            )}
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {marketErrorText(t, i18n.language, error)}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !inBand || Boolean(quote?.refusal)}
            onClick={list}
          >
            {t("online.market.listConfirm")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
