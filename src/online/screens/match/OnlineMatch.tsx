import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { RADAR_PACING } from "../../../components/match/radar/useRadarDirector";
import type { MatchView } from "../../api";
import { online } from "../../client";
import { useOnlineStore } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import ResourceState from "../ResourceState";
import { MatchBoard } from "./MatchBoard";
import { MatchCommandPanel } from "./MatchCommandPanel";
import { MatchReplay } from "./MatchReplay";
import { MatchStatusStrip } from "./MatchStatusStrip";
import { type LiveMatchData, useLiveMatch } from "./useLiveMatch";

/** Whether a match is over: then it is replayed, not followed. */
const isOver = (view: MatchView) =>
  view.status === "finished" || view.status === "failed" || view.state.isFinished;

/**
 * A match at `/online/match/:matchId`: followed while it is played (C-2 §3.6), replayed once it
 * is over (C-2 §3.7).
 */
export default function OnlineMatch() {
  const { matchId = "" } = useParams();
  const { resource, reload } = useOnlineResource(() => online.matches.byId(matchId), [matchId]);
  return (
    <ResourceState resource={resource} reload={reload}>
      {(view) =>
        isOver(view) ? (
          <MatchReplay matchId={matchId} view={view} />
        ) : (
          <LiveMatch matchId={matchId} />
        )
      }
    </ResourceState>
  );
}

function LiveMatch({ matchId }: { matchId: string }) {
  const { live, reload, send } = useLiveMatch(matchId);
  const resource = live.status === "ready" ? ({ status: "ready", data: live.data } as const) : live;
  return (
    <ResourceState resource={resource} reload={reload}>
      {(data) => <LiveMatchScreen data={data} send={send} />}
    </ResourceState>
  );
}

function LiveMatchScreen({
  data,
  send,
}: {
  data: LiveMatchData;
  send: ReturnType<typeof useLiveMatch>["send"];
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

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      <MatchBoard
        state={state}
        mine={mine}
        pacing={pacing}
        paused={false}
        radarOpen={radarOpen}
        onToggleRadar={() => setRadarOpen((open) => !open)}
        strip={<MatchStatusStrip data={data} onReplace={setReplacing} />}
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
