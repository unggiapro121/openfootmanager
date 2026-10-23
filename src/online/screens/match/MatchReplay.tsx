import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Flag, History, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "../../../components/ui";
import type { MatchView } from "../../api";
import ResourceState from "../ResourceState";
import { MatchBoard } from "./MatchBoard";
import {
  REPLAY_SPEEDS,
  type ReplayData,
  useReplayPlayback,
  useReplaySource,
} from "./useMatchReplay";

const RESULT_LINK =
  "text-sm font-semibold text-primary-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:focus:ring-offset-navy-800";

function ResultLink({ view }: { view: MatchView }) {
  const { t } = useTranslation();
  if (!view.fixtureId) return null;
  return (
    <Link to={`/online/fixtures/${view.fixtureId}`} className={RESULT_LINK}>
      {t("online.match.seeResult")}
    </Link>
  );
}

/** A finished match, played again from its frames (C-2 §3.7, C2-14). */
export function MatchReplay({ matchId, view }: { matchId: string; view: MatchView }) {
  const { t } = useTranslation();
  const { resource, reload } = useReplaySource(matchId, view);
  return (
    <ResourceState resource={resource} reload={reload}>
      {(load) =>
        load.kind === "gone" ? (
          <div role="status" className="flex flex-col items-start gap-2">
            <p className="text-sm text-gray-700 dark:text-gray-300">{t("online.replay.gone")}</p>
            <ResultLink view={view} />
          </div>
        ) : (
          <ReplayScreen view={view} data={load.data} />
        )
      }
    </ResourceState>
  );
}

function ReplayScreen({ view, data }: { view: MatchView; data: ReplayData }) {
  const { t } = useTranslation();
  const replay = useReplayPlayback(data.source);
  const { shown } = replay;
  const lastMinute = data.source.frames[data.source.frames.length - 1]?.result.minute ?? 0;

  const controls = (
    <section
      aria-label={t("online.replay.controls")}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-navy-700 dark:bg-navy-800"
    >
      <span className="flex items-center gap-1 font-heading text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
        <History className="h-4 w-4" />
        {t("online.replay.title")}
      </span>
      <Button
        size="sm"
        onClick={replay.togglePlaying}
        aria-label={replay.playing ? t("online.replay.pause") : t("online.replay.play")}
      >
        {replay.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={replay.restart}
        aria-label={t("online.replay.restart")}
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      <fieldset className="flex items-center gap-1">
        <legend className="sr-only">{t("online.replay.speed")}</legend>
        {REPLAY_SPEEDS.map((speed) => (
          <button
            type="button"
            key={speed}
            aria-pressed={replay.speed === speed}
            onClick={() => replay.setSpeed(speed)}
            className={`rounded px-2 py-1 font-heading text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800 ${
              replay.speed === speed
                ? "bg-primary-500/20 text-primary-700 ring-1 ring-primary-500/50 dark:text-primary-400"
                : "bg-gray-100 text-gray-600 hover:text-gray-900 dark:bg-navy-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {t("online.replay.times", { speed })}
          </button>
        ))}
      </fieldset>
      <label className="flex min-w-48 flex-1 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        {t("online.replay.jump")}
        <input
          type="range"
          aria-label={t("online.replay.jump")}
          min={0}
          max={lastMinute}
          value={shown.minute}
          onChange={(event) => replay.jumpToMinute(Number(event.target.value))}
          className="flex-1 accent-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:accent-primary-400 dark:focus:ring-offset-navy-800"
        />
        <span className="w-10 text-right tabular-nums">{shown.minute}'</span>
      </label>
      {shown.isFinished && (
        <span className="flex items-center gap-2">
          <Flag className="h-4 w-4 text-primary-600 dark:text-primary-400" />
          <span className="font-heading text-xs font-bold uppercase tracking-wider text-gray-800 dark:text-gray-100">
            {t("match.fullTime")}
          </span>
          <ResultLink view={view} />
        </span>
      )}
    </section>
  );

  return (
    <MatchBoard
      state={shown}
      radarState={replay.ahead}
      mine={data.mine}
      pacing={replay.pacing}
      paused={!replay.playing}
      onCaughtUp={replay.onCaughtUp}
      radarKey={replay.radarKey}
      radarOpen={replay.radarOpen}
      onToggleRadar={replay.toggleRadar}
      strip={controls}
    />
  );
}
