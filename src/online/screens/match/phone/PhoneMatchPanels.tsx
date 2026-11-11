import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MatchStats } from "../../../../components/match/MatchPanels";
import type { RadarRoster } from "../../../../components/match/radar/radarMatch";
import type { MineView } from "../../../api";
import { type LiveSide, type OnlineMatchState, toStatsSource } from "../../../convert/matchState";
import { EventsPanel } from "../MatchBoard";
import { FOCUS } from "../../mobile/PhoneSheet";
import { onTablistKeyDown, tabIndexOf } from "../../mobile/tablistKeys";

type Panel = "events" | "stats" | "lineups";
const PANELS: Array<{ id: Panel; label: string }> = [
  { id: "events", label: "match.events" },
  { id: "stats", label: "match.stats" },
  { id: "lineups", label: "match.lineups" },
];

/** When each player came on, by id, from the match's substitutions. */
function cameOnAt(state: OnlineMatchState): Map<string, number> {
  return new Map(
    state.events
      .filter((event) => event.event_type === "Substitution" && event.player_id)
      .map((event) => [event.player_id ?? "", event.minute]),
  );
}

/**
 * One side's eleven as a card: shirt numbers, names, who came on when, who was sent off, and each
 * one's rating once the fixture is settled.
 */
function SideCard({
  side,
  mine,
  state,
  cameOn,
  ratings,
}: {
  side: LiveSide;
  mine: boolean;
  state: OnlineMatchState;
  cameOn: Map<string, number>;
  ratings?: Map<string, number>;
}) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800">
      <div
        className={`border-b border-gray-200 px-2.5 py-2 font-heading text-[13px] font-bold uppercase tracking-wider dark:border-navy-700 ${mine ? "text-primary-700 dark:text-primary-400" : "text-gray-700 dark:text-gray-200"}`}
      >
        {side.name} · {side.formation}
      </div>
      <ul aria-label={side.name} className="py-1">
        {side.eleven.map((player) => {
          const sentOff = state.sentOff.includes(player.id);
          const minute = cameOn.get(player.id);
          return (
            <li key={player.id} className="flex items-center gap-1.5 px-2.5 py-1 text-xs">
              <span className="w-[18px] text-right tabular-nums text-gray-500 dark:text-gray-400">
                {player.shirtNumber ?? "–"}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-gray-900 dark:text-white ${sentOff ? "line-through opacity-60" : ""}`}
              >
                {player.matchName}
              </span>
              {minute !== undefined && (
                <span className="text-[10px] text-primary-700 dark:text-primary-400">
                  ↑ {minute}'
                </span>
              )}
              {sentOff && (
                <span
                  role="img"
                  aria-label={t("match.eventTypes.RedCard")}
                  className="h-3 w-2 rounded-[2px] bg-red-600"
                />
              )}
              {!sentOff && state.booked.includes(player.id) && (
                <span
                  role="img"
                  aria-label={t("match.eventTypes.YellowCard")}
                  className="h-3 w-2 rounded-[2px] bg-yellow-400"
                />
              )}
              {ratings?.has(player.id) && (
                <span className="w-7 text-right font-heading font-bold tabular-nums text-gray-900 dark:text-white">
                  {ratings.get(player.id)?.toFixed(1)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The match's events, stats and line-ups under three tabs (design m-tran-dau): the game's own
 * event feed and stats, and each side's eleven on a card.
 */
export function PhoneMatchPanels({
  state,
  mine,
  roster,
  initialPanel = "events",
  ratings,
}: {
  state: OnlineMatchState;
  mine: MineView | null;
  roster: RadarRoster;
  /** The tab open first: the events in play, the stats in the break (D-HT4). */
  initialPanel?: Panel;
  /** Each player's rating, by id, once the fixture is settled (D-FT5). */
  ratings?: Map<string, number>;
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const cameOn = cameOnAt(state);
  return (
    <>
      <div
        role="tablist"
        onKeyDown={onTablistKeyDown}
        aria-label={t("online.match.panels")}
        className="mx-3 mt-3 grid grid-cols-3 rounded-[10px] border border-gray-200 bg-white p-[3px] dark:border-navy-700 dark:bg-navy-800"
      >
        {PANELS.map((one) => {
          const on = one.id === panel;
          return (
            <button
              key={one.id}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={tabIndexOf(on)}
              onClick={() => setPanel(one.id)}
              className={`h-9 rounded-lg text-[13px] font-semibold ${on ? "bg-gray-100 text-gray-900 dark:bg-navy-700 dark:text-white" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}
            >
              {t(one.label)}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="px-3 pb-4 pt-2.5">
        {panel === "events" && <EventsPanel state={state} mine={mine} roster={roster} />}
        {panel === "stats" && <MatchStats snapshot={toStatsSource(state)} />}
        {panel === "lineups" && (
          <div className="grid grid-cols-2 gap-2">
            <SideCard
              side={state.home}
              mine={mine?.side === "Home"}
              state={state}
              cameOn={cameOn}
              ratings={ratings}
            />
            <SideCard
              side={state.away}
              mine={mine?.side === "Away"}
              state={state}
              cameOn={cameOn}
              ratings={ratings}
            />
          </div>
        )}
      </div>
    </>
  );
}
