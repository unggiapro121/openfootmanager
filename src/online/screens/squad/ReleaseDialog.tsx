import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
import { Button } from "../../../components/ui";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { ReleaseQuoteView, SquadPlayerView } from "../../api";
import { online } from "../../client";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import { marketErrorText, refusalText } from "../market/marketText";
import { useActionKey } from "../useActionKey";

/**
 * Letting one of the club's players go (the offline "terminate contract"): the server's quote
 * first, so what it costs and any reason it would be refused show before the coach confirms. He
 * leaves for the free agents; to be paid for him the coach sells him.
 */
export default function ReleaseDialog({
  player,
  onClose,
}: {
  player: SquadPlayerView;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const offline = useOnlineStore((state) => state.network === "offline");
  const [quote, setQuote] = useState<ReleaseQuoteView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { run } = useActionKey();

  useEffect(() => {
    let live = true;
    tracked(() => online.players.releaseQuote(player.id))
      .then((answer) => live && setQuote(answer))
      .catch((failure: unknown) => live && setError(failure));
    return () => {
      live = false;
    };
  }, [player.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const release = () => {
    setBusy(true);
    setError(null);
    run((key) => tracked(() => online.players.release(player.id, key)))
      .then((club) => {
        useOnlineStore.getState().setClub(club);
        navigate("/online/squad");
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div role="dialog" aria-modal="true" aria-labelledby="release-title" className="space-y-4">
        <div>
          <h3
            id="release-title"
            className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
          >
            {t("online.player.releaseTitle", { name: player.matchName })}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t("online.player.releaseHint")}
          </p>
        </div>
        {quote === null && error === null && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>
        )}
        {quote && (
          <dl className="grid grid-cols-2 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
            {quote.weeklyWage !== undefined && (
              <>
                <dt>{t("online.player.releaseWage")}</dt>
                <dd className="text-right">{formatExactMoney(quote.weeklyWage)}</dd>
              </>
            )}
            <dt>{t("online.player.releaseSeverance")}</dt>
            <dd className="text-right font-semibold">{formatExactMoney(quote.severance)}</dd>
            {quote.cash !== undefined && (
              <>
                <dt>{t("online.player.releaseCash")}</dt>
                <dd className="text-right">{formatExactMoney(quote.cash)}</dd>
              </>
            )}
            <dt>{t("online.player.releaseSquad", { min: quote.squadMin })}</dt>
            <dd className="text-right">{quote.squadAfter}</dd>
          </dl>
        )}
        {quote?.refusal && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {refusalText(t, i18n.language, quote.refusal)}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {marketErrorText(t, i18n.language, error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t("online.cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            disabled={busy || offline || quote === null || Boolean(quote.refusal)}
            onClick={release}
          >
            {t("online.player.releaseConfirm")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
