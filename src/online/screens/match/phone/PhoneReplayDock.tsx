import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ListOrdered, Pause, Play, RotateCcw } from "lucide-react";
import type { MatchView, MineView } from "../../../api";
import { type ReplaySource, replayAt } from "../../../convert/replay";
import { FriendlyAfterMatch } from "../../friendly/FriendlyAfterMatch";
import { FOCUS } from "../../mobile/PhoneSheet";
import { REPLAY_SPEEDS, type useReplayPlayback } from "../useMatchReplay";

type Playback = ReturnType<typeof useReplayPlayback>;

/** A moment the scrubber marks (D-RP2): a goal in its side's colour, or a red card. */
type Mark = { minute: number; kind: "Goal" | "RedCard"; side: "Home" | "Away" };

const ROUND = `inline-flex items-center justify-center rounded-full ${FOCUS}`;
const WIDE = `inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 font-heading text-sm font-bold uppercase tracking-wider ${FOCUS}`;

/** The goals and red cards of the whole match, and the minute of its break, for the scrubber. */
function marksOf(source: ReplaySource): { marks: Mark[]; breakAt?: number } {
  const events = replayAt(source, source.frames.length).events;
  const marks: Mark[] = [];
  for (const event of events) {
    if (event.event_type === "Goal" || event.event_type === "PenaltyGoal") {
      marks.push({ minute: event.minute, kind: "Goal", side: event.side });
    } else if (event.event_type === "RedCard" || event.event_type === "SecondYellow") {
      marks.push({ minute: event.minute, kind: "RedCard", side: event.side });
    }
  }
  const breakAt = events.find((event) => event.event_type === "HalfTime")?.minute;
  return { marks: marks.sort((left, right) => left.minute - right.minute), breakAt };
}

/**
 * The controls of a replay at the foot of a phone (D-RP1): a scrubber marking the goals, red cards
 * and break, which moves the match only when let go (D-RP3), then restart, play or pause and the
 * speeds; at the end, watching again from the start and the ratings, or a friendly's way back
 * (D-RP6).
 */
export function PhoneReplayDock({
  view,
  mine,
  source,
  replay,
}: {
  view: MatchView;
  mine: MineView | null;
  source: ReplaySource;
  replay: Playback;
}) {
  const { t } = useTranslation();
  const { marks, breakAt } = useMemo(() => marksOf(source), [source]);
  const lastMinute = source.frames[source.frames.length - 1]?.result.minute ?? 0;
  const [dragged, setDragged] = useState<number | null>(null);
  const minute = dragged ?? replay.shown.minute;
  const atEnd = replay.shown.lastSeq >= source.frames.length;
  const at = (value: number) => `${lastMinute > 0 ? (value / lastMinute) * 100 : 0}%`;
  const letGo = () => {
    if (dragged === null) return;
    replay.jumpToMinute(dragged);
    setDragged(null);
  };

  return (
    <section
      aria-label={t("online.replay.controls")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-3 pt-2 pb-[calc(0.625rem+var(--safe-bottom))] backdrop-blur dark:border-navy-700 dark:bg-navy-800/95"
    >
      <div className="flex items-center gap-2 text-xs tabular-nums text-gray-600 dark:text-gray-300">
        <span className="w-8 font-semibold text-gray-900 dark:text-white">{`${minute}'`}</span>
        <div className="relative flex h-8 flex-1 items-center">
          {breakAt !== undefined && (
            <span
              aria-hidden="true"
              className="absolute top-1.5 h-5 w-px bg-gray-300 dark:bg-navy-600"
              style={{ left: at(breakAt) }}
            />
          )}
          {marks.map((mark) => (
            <span
              key={`${mark.kind}-${mark.minute}-${mark.side}`}
              role="img"
              aria-label={`${t(`match.eventTypes.${mark.kind}`)} ${mark.minute}'`}
              className={`pointer-events-none absolute top-0 -ml-1 h-2 w-2 ${mark.kind === "RedCard" ? "rounded-[1px] bg-red-600" : mark.side === "Home" ? "rounded-full bg-primary-500" : "rounded-full bg-indigo-500"}`}
              style={{ left: at(mark.minute) }}
            />
          ))}
          <input
            type="range"
            aria-label={t("online.replay.jump")}
            min={0}
            max={lastMinute}
            value={minute}
            onPointerDown={() => setDragged(replay.shown.minute)}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (dragged === null) replay.jumpToMinute(value);
              else setDragged(value);
            }}
            onPointerUp={letGo}
            onPointerCancel={letGo}
            className="w-full accent-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:accent-primary-400 dark:focus:ring-offset-navy-800"
          />
        </div>
        <span className="w-8 text-right">{`${lastMinute}'`}</span>
      </div>
      {atEnd ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={replay.restart}
            className={`${WIDE} border border-gray-200 bg-white text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-white`}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t("online.replay.fromStart")}
          </button>
          {view.fixtureId && (
            <Link
              to={`/online/fixtures/${view.fixtureId}`}
              className={`${WIDE} bg-primary-700 text-white`}
            >
              <ListOrdered className="h-4 w-4" aria-hidden="true" />
              {t("online.match.phone.ratings")}
            </Link>
          )}
          {view.kind === "friendly" && (
            <FriendlyAfterMatch matchId={view.id} inline coach={mine !== null} />
          )}
        </div>
      ) : (
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={replay.restart}
            aria-label={t("online.replay.restart")}
            className={`${ROUND} h-11 w-11 border border-gray-200 text-gray-700 dark:border-navy-600 dark:text-gray-200`}
          >
            <RotateCcw className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={replay.togglePlaying}
            aria-label={replay.playing ? t("online.replay.pause") : t("online.replay.play")}
            className={`${ROUND} h-14 w-14 bg-primary-700 text-white`}
          >
            {replay.playing ? (
              <Pause className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Play className="h-6 w-6" aria-hidden="true" />
            )}
          </button>
          <fieldset className="flex items-center gap-1">
            <legend className="sr-only">{t("online.replay.speed")}</legend>
            {REPLAY_SPEEDS.map((speed) => (
              <button
                type="button"
                key={speed}
                aria-pressed={replay.speed === speed}
                onClick={() => replay.setSpeed(speed)}
                className={`h-11 min-w-11 rounded-lg px-2 font-heading text-sm font-bold ${FOCUS} ${
                  replay.speed === speed
                    ? "bg-primary-500/20 text-primary-700 ring-1 ring-primary-500/50 dark:text-primary-400"
                    : "bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-400"
                }`}
              >
                {t("online.replay.times", { speed })}
              </button>
            ))}
          </fieldset>
        </div>
      )}
    </section>
  );
}
