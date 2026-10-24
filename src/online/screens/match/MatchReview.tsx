import { useId, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getEventDisplay } from "../../../components/match/helpers";
import { EventFeed, MatchStats } from "../../../components/match/MatchPanels";
import {
  type OnlineMatchState,
  toFeedSource,
  toRadarRoster,
  toStatsSource,
} from "../../convert/matchState";
import { Lineups } from "./MatchBoard";

export const REVIEW_CARD =
  "flex min-w-0 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-navy-700 dark:bg-navy-800";
const CARD_TITLE =
  "font-heading text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400";

/**
 * A match so far, where the radar would only stand still (C2-12): its key events and stats under
 * `title`, and both line-ups. The half-time break and the match report share it.
 */
export function MatchReview({ state, title }: { state: OnlineMatchState; title: string }) {
  const { t } = useTranslation();
  const reviewId = useId();
  const feedRef = useRef<HTMLDivElement>(null);
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
    <>
      <section aria-labelledby={reviewId} className={`${REVIEW_CARD} flex-[1_1_320px]`}>
        <h3 id={reviewId} className={CARD_TITLE}>
          {title}
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
      <section className={`${REVIEW_CARD} flex-[1_1_280px]`}>
        <h3 className={CARD_TITLE}>{t("match.lineups")}</h3>
        <Lineups state={state} />
      </section>
    </>
  );
}
