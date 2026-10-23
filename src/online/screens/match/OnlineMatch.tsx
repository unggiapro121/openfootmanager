import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { BarChart3, MessageSquare, Users } from "lucide-react";
import { getEventDisplay, phaseLabel } from "../../../components/match/helpers";
import { EventFeed, MatchStats } from "../../../components/match/MatchPanels";
import { MatchRadar2D } from "../../../components/match/radar/MatchRadar2D";
import { pickRadarKits } from "../../../components/match/radar/radarGeometry";
import { RADAR_PACING } from "../../../components/match/radar/useRadarDirector";
import { useSettingsStore } from "../../../store/settingsStore";
import type { ClubColors } from "../../api";
import {
  type LiveSide,
  toFeedSource,
  toRadarDials,
  toRadarMatch,
  toRadarRoster,
  toStatsSource,
} from "../../convert/matchState";
import { useOnlineStore } from "../../store/onlineStore";
import ResourceState from "../ResourceState";
import { MatchCommandPanel } from "./MatchCommandPanel";
import { MatchStatusStrip } from "./MatchStatusStrip";
import { type LiveMatchData, useLiveMatch } from "./useLiveMatch";

type Panel = "events" | "stats" | "lineups";

/** A live match, or one just played, at `/online/match/:matchId` (C-2 §3.6). */
export default function OnlineMatch() {
  const { matchId = "" } = useParams();
  const { live, reload, send } = useLiveMatch(matchId);
  const resource = live.status === "ready" ? ({ status: "ready", data: live.data } as const) : live;
  return (
    <ResourceState resource={resource} reload={reload}>
      {(data) => <MatchScreen data={data} send={send} />}
    </ResourceState>
  );
}

function Scoreboard({ data }: { data: LiveMatchData }) {
  const { t } = useTranslation();
  const { state } = data;
  const team = (side: LiveSide, align: "left" | "right") => (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <p className="font-heading text-sm font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200">
        {side.name}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{side.formation}</p>
    </div>
  );
  return (
    <div className="flex items-center justify-center gap-6 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-navy-700 dark:bg-navy-800">
      {team(state.home, "right")}
      <h1 className="flex items-center gap-3 font-heading font-bold">
        <span className="text-4xl tabular-nums text-gray-900 dark:text-white">
          {state.homeScore}
        </span>
        <span className="flex flex-col items-center">
          <span className="text-xs uppercase tracking-widest text-accent-700 dark:text-accent-400">
            {phaseLabel(state.phase, t)}
          </span>
          <span className="text-2xl text-gray-500 dark:text-gray-400">{state.minute}'</span>
        </span>
        <span className="text-4xl tabular-nums text-gray-900 dark:text-white">
          {state.awayScore}
        </span>
        <span className="sr-only">
          {t("online.match.scoreLine", {
            home: state.home.name,
            away: state.away.name,
            homeScore: state.homeScore,
            awayScore: state.awayScore,
          })}
        </span>
      </h1>
      {team(state.away, "left")}
    </div>
  );
}

function Lineups({ data }: { data: LiveMatchData }) {
  const { t } = useTranslation();
  const { state } = data;
  const column = (side: LiveSide) => (
    <div className="flex-1">
      <h3 className="mb-1 font-heading text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
        {side.name}
      </h3>
      <ul className="text-sm text-gray-800 dark:text-gray-100">
        {side.eleven.map((player) => (
          <li key={player.id} className={state.sentOff.includes(player.id) ? "line-through" : ""}>
            {player.shirtNumber ?? "–"}. {player.matchName}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs font-heading uppercase tracking-widest text-gray-500 dark:text-gray-400">
        {t("match.bench")}
      </p>
      <ul className="text-sm text-gray-600 dark:text-gray-300">
        {side.bench.map((player) => (
          <li key={player.id}>
            {player.shirtNumber ?? "–"}. {player.matchName}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="flex gap-6">
      {column(state.home)}
      {column(state.away)}
    </div>
  );
}

function useRadarKits(data: LiveMatchData) {
  const colors = useOnlineStore((store) => store.club?.club.colors);
  const side = data.mine?.side;
  return useMemo(() => {
    const own: ClubColors | undefined = side ? colors : undefined;
    return side === "Away" ? pickRadarKits(undefined, own) : pickRadarKits(own, undefined);
  }, [colors, side]);
}

function MatchScreen({
  data,
  send,
}: {
  data: LiveMatchData;
  send: ReturnType<typeof useLiveMatch>["send"];
}) {
  const { t } = useTranslation();
  const showCommentary = useSettingsStore((store) => store.settings.show_match_commentary);
  const offline = useOnlineStore((store) => store.network === "offline");
  const [panel, setPanel] = useState<Panel>("events");
  const [radarOpen, setRadarOpen] = useState(true);
  const [replacing, setReplacing] = useState<string | undefined>(undefined);
  const feedRef = useRef<HTMLDivElement>(null);
  const { view, state, mine } = data;

  const kits = useRadarKits(data);
  const roster = useMemo(() => toRadarRoster(state), [state]);
  const radar = useMemo(() => {
    const dials = mine
      ? { [mine.side === "Home" ? "home" : "away"]: toRadarDials(mine.tactics) }
      : {};
    return toRadarMatch(state, dials);
  }, [state, mine]);
  const pacing = useMemo(
    () => ({ timeScale: RADAR_PACING.timeScale, maxLagMs: 2 * view.stepMillis }),
    [view.stepMillis],
  );
  const feed = useMemo(() => toFeedSource(state), [state]);
  const important = useMemo(
    () => feed.events.filter((event) => getEventDisplay(event).important),
    [feed],
  );
  const jerseys = useMemo(
    () =>
      new Map(
        [...roster].flatMap(([id, entry]) =>
          entry.jersey_number != null ? [[id, entry.jersey_number] as const] : [],
        ),
      ),
    [roster],
  );
  const adjustments = state.adjustments.filter((line) => line.side !== mine?.side);

  const tabs: { id: Panel; label: string; icon: React.ReactNode }[] = [
    { id: "events", label: t("match.events"), icon: <MessageSquare className="h-4 w-4" /> },
    { id: "stats", label: t("match.stats"), icon: <BarChart3 className="h-4 w-4" /> },
    { id: "lineups", label: t("match.lineups"), icon: <Users className="h-4 w-4" /> },
  ];

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Scoreboard data={data} />
        <MatchStatusStrip data={data} onReplace={setReplacing} />
        <MatchRadar2D
          roster={roster}
          snapshot={radar}
          kits={kits}
          isOpen={radarOpen}
          onToggle={() => setRadarOpen((open) => !open)}
          paused={false}
          showCommentary={showCommentary}
          pacing={pacing}
        />
        <div
          role="tablist"
          aria-label={t("online.match.panels")}
          className="flex border-b border-gray-200 dark:border-navy-700"
        >
          {tabs.map((tab) => (
            <button
              type="button"
              role="tab"
              key={tab.id}
              aria-selected={panel === tab.id}
              onClick={() => setPanel(tab.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2 font-heading text-xs font-bold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800 ${
                panel === tab.id
                  ? "border-primary-500 text-primary-700 dark:text-primary-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {panel === "events" && (
            <div className="flex flex-col gap-2">
              {adjustments.length > 0 && (
                <ul className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
                  {adjustments.map((line) => (
                    <li key={`${line.side}-${line.seq}`}>
                      {line.minute}' ·{" "}
                      {t("online.match.adjusted", {
                        team: (line.side === "Home" ? state.home : state.away).name,
                      })}
                    </li>
                  ))}
                </ul>
              )}
              {important.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {state.minute === 0 ? t("match.waitingKickoff") : t("match.noMajorEvents")}
                </p>
              ) : (
                <EventFeed
                  events={important}
                  snapshot={feed}
                  feedRef={feedRef}
                  playerJerseyMap={jerseys}
                />
              )}
            </div>
          )}
          {panel === "stats" && <MatchStats snapshot={toStatsSource(state)} />}
          {panel === "lineups" && <Lineups data={data} />}
        </div>
      </div>
      {mine !== null && !state.isFinished && (
        <aside
          aria-label={t("online.match.touchline")}
          className="w-full shrink-0 rounded-lg border border-gray-200 bg-white xl:w-80 dark:border-navy-700 dark:bg-navy-800"
        >
          <MatchCommandPanel
            state={state}
            side={mine.side}
            sent={data.sent}
            onSend={send}
            initialOff={replacing}
            disabled={offline}
          />
        </aside>
      )}
    </div>
  );
}
