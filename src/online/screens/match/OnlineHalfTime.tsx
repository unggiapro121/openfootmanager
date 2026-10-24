import { type ReactNode, useId, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Coffee } from "lucide-react";
import { getEventDisplay } from "../../../components/match/helpers";
import { EventFeed, MatchStats } from "../../../components/match/MatchPanels";
import type { MatchCommand } from "../../api/engine";
import { toFeedSource, toRadarRoster, toStatsSource } from "../../convert/matchState";
import { Lineups, Scoreboard } from "./MatchBoard";
import { MatchCommandPanel } from "./MatchCommandPanel";
import type { LiveMatchData } from "./useLiveMatch";

const CARD =
  "flex min-w-0 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-navy-700 dark:bg-navy-800";
const CARD_TITLE =
  "font-heading text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400";

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
  const reviewId = useId();
  const feedRef = useRef<HTMLDivElement>(null);
  const { state, mine } = data;
  const feed = useMemo(() => toFeedSource(state), [state]);
  const important = useMemo(
    () => feed.events.filter((event) => getEventDisplay(event).important),
    [feed],
  );
  const jerseys = useMemo(
    () =>
      new Map(
        [...toRadarRoster(state)].flatMap(([id, entry]) =>
          entry.jersey_number != null ? [[id, entry.jersey_number] as const] : [],
        ),
      ),
    [state],
  );

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
        <section aria-labelledby={reviewId} className={`${CARD} flex-[1_1_320px]`}>
          <h3 id={reviewId} className={CARD_TITLE}>
            {t("match.firstHalfEvents")}
          </h3>
          {important.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("match.noMajorEvents")}</p>
          ) : (
            <EventFeed
              events={important}
              snapshot={feed}
              feedRef={feedRef}
              playerJerseyMap={jerseys}
            />
          )}
          <MatchStats snapshot={toStatsSource(state)} />
        </section>
        <section className={`${CARD} flex-[1_1_280px]`}>
          <h3 className={CARD_TITLE}>{t("match.lineups")}</h3>
          <Lineups state={state} />
        </section>
        {mine !== null && (
          <aside
            aria-label={t("online.match.touchline")}
            className="w-full shrink-0 rounded-lg border border-gray-200 bg-white xl:w-80 dark:border-navy-700 dark:bg-navy-800"
          >
            <MatchCommandPanel
              state={state}
              side={mine.side}
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
