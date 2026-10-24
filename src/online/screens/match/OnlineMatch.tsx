import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { RADAR_PACING } from "../../../components/match/radar/useRadarDirector";
import type { MatchView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { useOnlineStore } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import { FriendlyAfterMatch } from "../friendly/FriendlyAfterMatch";
import ResourceState from "../ResourceState";
import { MatchBoard } from "./MatchBoard";
import { MatchCommandPanel } from "./MatchCommandPanel";
import { MatchReplay } from "./MatchReplay";
import { MatchStatusStrip } from "./MatchStatusStrip";
import { OnlineFullTime } from "./OnlineFullTime";
import { OnlineHalfTime } from "./OnlineHalfTime";
import { type LiveMatchData, useLiveMatch } from "./useLiveMatch";

/** Whether a match is over: then it is replayed, not followed. */
const isOver = (view: MatchView) =>
  view.status === "finished" || view.status === "failed" || view.state.isFinished;

/**
 * A match at `/online/match/:matchId`: followed while it is played (C-2 §3.6), replayed once it
 * is over (C-2 §3.7).
 */
export default function OnlineMatch() {
  const { t } = useTranslation();
  const { matchId = "" } = useParams();
  const { resource, reload } = useOnlineResource(() => readMatch(matchId), [matchId]);
  return (
    <ResourceState resource={resource} reload={reload}>
      {(view) =>
        view === null ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">{t("online.replay.gone")}</p>
        ) : isOver(view) ? (
          <div className="flex flex-col gap-4">
            {view.kind === "friendly" && <FriendlyAfterMatch matchId={matchId} />}
            <MatchReplay matchId={matchId} view={view} />
          </div>
        ) : (
          <LiveMatch matchId={matchId} onReplay={reload} />
        )
      }
    </ResourceState>
  );
}

/** The match, or `null` once it is no longer kept (a friendly a week old, S12-15): a 404. */
async function readMatch(matchId: string): Promise<MatchView | null> {
  try {
    return await online.matches.byId(matchId);
  } catch (error) {
    if (error instanceof OnlineApiError && error.status === 404) return null;
    throw error;
  }
}

function LiveMatch({ matchId, onReplay }: { matchId: string; onReplay: () => void }) {
  const { live, reload, send } = useLiveMatch(matchId);
  const resource = live.status === "ready" ? ({ status: "ready", data: live.data } as const) : live;
  return (
    <ResourceState resource={resource} reload={reload}>
      {(data) => <LiveMatchScreen data={data} send={send} onReplay={onReplay} />}
    </ResourceState>
  );
}

function LiveMatchScreen({
  data,
  send,
  onReplay,
}: {
  data: LiveMatchData;
  send: ReturnType<typeof useLiveMatch>["send"];
  /** Read the match again: over, it opens as a replay. */
  onReplay: () => void;
}) {
  const { t } = useTranslation();
  const offline = useOnlineStore((store) => store.network === "offline");
  const [radarOpen, setRadarOpen] = useState(true);
  const [replacing, setReplacing] = useState<string | undefined>(undefined);
  const { view, state, mine } = data;
  const pacing = useMemo(
    () => ({ timeScale: RADAR_PACING.timeScale, maxLagMs: 2 * view.stepMillis }),
    [view.stepMillis],
  );

  const strip = <MatchStatusStrip data={data} onReplace={setReplacing} />;
  // Over: the players would go on standing about on the radar, so the viewer gets the report.
  if (state.isFinished) {
    return <OnlineFullTime state={state} mine={mine} strip={strip} onReplay={onReplay} />;
  }
  // The break: the radar would only stand still, so the coaches get the half-time screen.
  if (state.phase === "HalfTime" && !state.isFinished) {
    return (
      <OnlineHalfTime
        data={data}
        strip={strip}
        send={send}
        initialOff={replacing}
        disabled={offline}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      <MatchBoard
        state={state}
        mine={mine}
        pacing={pacing}
        paused={false}
        radarOpen={radarOpen}
        onToggleRadar={() => setRadarOpen((open) => !open)}
        strip={strip}
      />
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
