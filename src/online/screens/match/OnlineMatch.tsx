import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { RADAR_PACING } from "../../../components/match/radar/useRadarDirector";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import type { MatchView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { useOnlineStore } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import { useLeaveGuard } from "../leaveGuard";
import ResourceState from "../ResourceState";
import { MatchBoard } from "./MatchBoard";
import { MatchCommandPanel } from "./MatchCommandPanel";
import { MatchReplay } from "./MatchReplay";
import { MatchStatusStrip, useHalfTimeStart } from "./MatchStatusStrip";
import { useShownState } from "./liveShown";
import { OnlineFullTime } from "./OnlineFullTime";
import { OnlineHalfTime } from "./OnlineHalfTime";
import { PhoneFullTime } from "./phone/PhoneFullTime";
import { PhoneHalfTime } from "./phone/PhoneHalfTime";
import { PhoneLiveMatch } from "./phone/PhoneLiveMatch";
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
          <MatchReplay matchId={matchId} view={view} />
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
  const phone = usePhoneLayout();
  const { view, state, mine } = data;
  // The screen shows the match as far as the radar has played it, so a goal is not read off the
  // score before it is seen; the touchline acts on the server's own match.
  const { shown, onPlayed } = useShownState(state, radarOpen);
  const halfTimeSince = useHalfTimeStart(state.phase);
  // Away from the match for `absentGraceSteps` steps, the coach hands the side to the AI (C2-13).
  useLeaveGuard(mine !== null && !state.isFinished);
  // The server plays a minute every `stepMillis` and does not wait for the radar: quiet minutes
  // are acted out in full so the radar does not stand still, and it may fall three minutes
  // behind before it skips play, so a long move a minute ends on is not cut short.
  const pacing = useMemo(
    () => ({
      timeScale: RADAR_PACING.timeScale,
      maxLagMs: 3 * view.stepMillis,
      minuteMs: view.stepMillis,
    }),
    [view.stepMillis],
  );

  const strip = (
    <MatchStatusStrip
      data={data}
      shown={shown}
      halfTimeSince={halfTimeSince}
      onReplace={setReplacing}
      phone={phone}
    />
  );
  // Over: the players would go on standing about on the radar, so the viewer gets the report.
  if (shown.isFinished) {
    if (phone) return <PhoneFullTime data={data} state={shown} onReplay={onReplay} />;
    return (
      <OnlineFullTime
        state={shown}
        mine={mine}
        strip={strip}
        venue={view.venue}
        atmosphere={view.atmosphere}
        onReplay={onReplay}
      />
    );
  }
  // The break: the radar would only stand still, so the coaches get the half-time screen.
  if (shown.phase === "HalfTime") {
    if (phone) {
      return (
        <PhoneHalfTime
          data={data}
          strip={strip}
          send={send}
          halfTimeSince={halfTimeSince}
          replacing={replacing}
          disabled={offline}
        />
      );
    }
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

  if (phone) {
    return (
      <PhoneLiveMatch
        data={data}
        shown={shown}
        strip={strip}
        send={send}
        pacing={pacing}
        radarOpen={radarOpen}
        onToggleRadar={() => setRadarOpen((open) => !open)}
        onPlayed={onPlayed}
        replacing={replacing}
        disabled={offline}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      <MatchBoard
        state={shown}
        radarState={state}
        onPlayed={onPlayed}
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
          {shown.minute !== state.minute && (
            <p role="status" className="px-3 pt-3 text-xs text-gray-500 dark:text-gray-400">
              {t("online.match.serverMinute", { minute: state.minute })}
            </p>
          )}
          <MatchCommandPanel
            state={state}
            mine={mine}
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
