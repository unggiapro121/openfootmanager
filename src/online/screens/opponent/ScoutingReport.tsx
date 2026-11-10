import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";
import { Button } from "../../../components/ui";
import { formatExactMoney } from "../../../lib/valueFormatting";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { OpponentReportQuoteView, OpponentReportRefusal } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { formatMoment } from "../../format";
import { refreshFinance, tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import ConfirmDialog from "../ConfirmDialog";
import { useActionKey } from "../useActionKey";
import { useCountdownText } from "../useCountdownText";

const ALREADY_BOUGHT = "be.error.opponentReport.alreadyBought";
const MINUTE_MS = 60_000;

/** A refusal the button stays for, switched off with its reason (C-24 §8.1). */
type Blocked = Exclude<OpponentReportRefusal, "disabled" | "alreadyBought">;
const REFUSED: Record<Blocked, string> = {
  noFixture: "online.opponentReport.refused.noFixture",
  notScheduled: "online.opponentReport.refused.notScheduled",
  tooLate: "online.opponentReport.refused.tooLate",
  limitReached: "online.opponentReport.refused.limitReached",
  clubLocked: "online.opponentReport.refused.clubLocked",
  insufficientFunds: "online.opponentReport.refused.insufficientFunds",
};

/**
 * The price of a report as the server would sell it now, kept while it is read again after a
 * purchase, so the block does not blink out and back.
 */
function useQuote() {
  const [quote, setQuote] = useState<OpponentReportQuoteView | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    tracked(() => online.opponentReports.quote())
      .then((view) => current && setQuote(view))
      // An extra block: when its price cannot be read, the profile simply goes without it.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [attempt]);
  return { quote, reload: () => setAttempt((value) => value + 1) };
}

/**
 * The scouting report on the next league opponent (C-24a, S-47a): what one costs and when it
 * would be back, the purchase after a question, and the scout out once bought. Drawn only for
 * the club the server names as that opponent, and not at all while reports are switched off.
 */
export default function ScoutingReport({
  opponentId,
  frame,
}: {
  opponentId: string;
  frame: (title: string, body: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation();
  const { quote, reload } = useQuote();
  if (!quote || quote.refused === "disabled") return null;
  // The coach's next fixture may be a cup match; the report is for the next league one.
  if (quote.opponent && quote.opponent.id !== opponentId) return null;
  const body =
    quote.refused === "alreadyBought" ? (
      <Bought reportId={quote.reportId} fixtureId={quote.fixtureId} />
    ) : (
      <Offer quote={quote} reload={reload} />
    );
  return frame(t("online.opponentReport.title"), body);
}

function Offer({ quote, reload }: { quote: OpponentReportQuoteView; reload: () => void }) {
  const { t, i18n } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();
  const { refused, fixtureId, costEur, readyAt, locksAt } = quote;
  const cost = costEur === undefined ? "" : formatExactMoney(costEur);
  const time = readyAt ? formatMoment(readyAt, i18n.language) : "";

  const buy = () => {
    if (!fixtureId) return;
    setAsking(false);
    setBusy(true);
    setError(null);
    run((key) => tracked(() => online.opponentReports.buy(fixtureId, key)), fixtureId)
      .then(() => {
        void refreshFinance().catch(() => undefined);
        reload();
      })
      .catch((failure: unknown) => {
        // Bought by another request (G3): the server names no report, the quote does.
        if (failure instanceof OnlineApiError && failure.code === ALREADY_BOUGHT) reload();
        else setError(failure);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.opponentReport.about")}</p>
      <Button
        type="button"
        disabled={busy || refused !== undefined || !fixtureId}
        onClick={() => setAsking(true)}
        className="self-start"
      >
        <Eye aria-hidden="true" className="mr-2 h-4 w-4" />
        {t("online.opponentReport.buy", { cost })}
      </Button>
      {refused !== undefined && (
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t(REFUSED[refused as Blocked])}
        </p>
      )}
      {quote.clubLeft !== undefined &&
        quote.personLeft !== undefined &&
        quote.perSeason !== undefined && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.opponentReport.left", {
              n: Math.min(quote.clubLeft, quote.personLeft),
              of: quote.perSeason,
            })}
          </p>
        )}
      {refused === undefined && readyAt && locksAt && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.opponentReport.back", {
            time,
            minutes: Math.max(
              0,
              Math.round((Date.parse(locksAt) - Date.parse(readyAt)) / MINUTE_MS),
            ),
          })}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
      {asking && (
        <ConfirmDialog
          title={t("online.opponentReport.confirmTitle")}
          body={t("online.opponentReport.confirmBody", { cost, time })}
          confirm={t("online.opponentReport.confirm")}
          onCancel={() => setAsking(false)}
          onConfirm={buy}
        />
      )}
    </div>
  );
}

/** The club's report for this match: out, in, or paid back; or only known to exist (G3). */
function Bought({ reportId, fixtureId }: { reportId?: string; fixtureId?: string }) {
  const { t } = useTranslation();
  const { resource } = useOnlineResource(
    () =>
      reportId && fixtureId
        ? tracked(() => online.opponentReports.list({ fixtureId }))
        : Promise.resolve({ reports: [] }),
    [reportId, fixtureId],
  );
  const report =
    resource.status === "ready"
      ? resource.data.reports.find((candidate) => candidate.id === reportId)
      : undefined;
  if (reportId && resource.status === "loading") return null;
  if (!report) return <Line>{t("online.opponentReport.bought")}</Line>;
  if (report.status === "pending") return <Pending readyAt={report.readyAt} />;
  return (
    <Line>
      {report.status === "ready"
        ? t("online.opponentReport.ready")
        : t("online.opponentReport.refunded")}
    </Line>
  );
}

/**
 * The scout out, counted down on this machine's clock: the report's views carry no `serverNow`,
 * and a few seconds off do not matter for a wait of hours.
 */
function Pending({ readyAt }: { readyAt: string }) {
  const { t } = useTranslation();
  const left = useCountdownText(readyAt);
  return (
    <Line>
      {left
        ? t("online.opponentReport.pending", { time: left })
        : t("online.opponentReport.pendingSoon")}
    </Line>
  );
}

function Line({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <Eye aria-hidden="true" className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
      {children}
    </p>
  );
}
