import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Coffee } from "lucide-react";
import type { MatchCommand } from "../../api/engine";
import { Scoreboard } from "./MatchBoard";
import { MatchCommandPanel } from "./MatchCommandPanel";
import { MatchReview } from "./MatchReview";
import type { LiveMatchData } from "./useLiveMatch";

/**
 * The half-time break of a live online match (C-2 C2-12): in place of the radar, which only stands
 * still while the server waits, the first half's key events and stats, the line-ups, and the
 * touchline to change the side with. Orders sent now are applied before the second half kicks
 * off. No team talk online (Q8). A spectator sees the review and the line-ups.
 */
export function OnlineHalfTime({
  data,
  strip,
  send,
  initialOff,
  disabled,
}: {
  data: LiveMatchData;
  /** What the viewer should know now: who holds the side, the countdown to the second half. */
  strip: ReactNode;
  send: (command: MatchCommand) => Promise<void>;
  initialOff?: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const { state, mine } = data;

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <Scoreboard state={state} />
      <div className="flex items-center gap-3">
        <Coffee className="h-5 w-5 shrink-0 text-accent-600 dark:text-accent-400" />
        <h2
          id={titleId}
          className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {t("match.halfTime")}
        </h2>
        {mine !== null && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("online.match.halfTimeHint")}
          </p>
        )}
      </div>
      {strip}
      <div className="flex flex-wrap items-start gap-4">
        <MatchReview state={state} title={t("match.firstHalfEvents")} />
        {mine !== null && (
          <aside
            aria-label={t("online.match.touchline")}
            className="w-full shrink-0 rounded-lg border border-gray-200 bg-white xl:w-80 dark:border-navy-700 dark:bg-navy-800"
          >
            <MatchCommandPanel
              state={state}
              mine={mine}
              sent={data.sent}
              onSend={send}
              initialOff={initialOff}
              disabled={disabled}
            />
          </aside>
        )}
      </div>
    </section>
  );
}
