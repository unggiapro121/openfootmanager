import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useGameStore } from "../../../store/gameStore";
import type { MatchSnapshot } from "../types";
import type { RadarCaption } from "./radarCaptions";
import {
  type CommentaryFeed,
  EMPTY_FEED,
  nextChangeAt,
  receiveLine,
  settleFeed,
} from "./radarCommentaryFeed";
import { type CommentaryText, captionText, radarNameOf } from "./radarCommentaryText";

/** Where the radar says its captions: the bar listens on it. */
export type CaptionSink = (caption: RadarCaption) => void;

interface RadarCommentaryProps {
  /** The match as the radar plays it: its teams, players and events name what is said. */
  snapshot: MatchSnapshot;
  sinkRef: RefObject<CaptionSink | null>;
}

const HEADLINE_CLASS = {
  Home: "text-primary-600 dark:text-primary-400",
  Away: "text-indigo-600 dark:text-indigo-400",
} as const;

/**
 * The commentator's line over the radar: what is happening on the pitch, said
 * as the radar plays it. Only this bar re-renders as lines change; the radar's
 * frame loop just says its captions into `sinkRef`. A key moment (a goal, a
 * card) is also announced to a screen reader; routine play is not, or it would
 * never stop talking.
 */
export function RadarCommentary({ snapshot, sinkRef }: RadarCommentaryProps) {
  const { t } = useTranslation();
  const squad = useGameStore((state) => state.gameState?.players);
  const squadById = useMemo(() => new Map((squad ?? []).map((p) => [p.id, p])), [squad]);
  const [feed, setFeed] = useState<CommentaryFeed<CommentaryText>>(EMPTY_FEED);
  const latest = useRef({ snapshot, t, squadById });
  latest.current = { snapshot, t, squadById };

  useEffect(() => {
    sinkRef.current = (caption) => {
      const current = latest.current;
      const nameOf = radarNameOf(current.snapshot, current.squadById);
      const text = captionText(caption, current.snapshot, current.t, nameOf);
      if (!text) return;
      setFeed((shown) => receiveLine(shown, text, caption.priority, Date.now()));
    };
    return () => {
      sinkRef.current = null;
    };
  }, [sinkRef]);

  useEffect(() => {
    const due = nextChangeAt(feed);
    if (due === null) return;
    const timer = setTimeout(
      () => setFeed((shown) => settleFeed(shown, Date.now())),
      Math.max(0, due - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [feed]);

  const shown = feed.current;
  const text = shown?.line;
  const full = text ? [text.headline, text.line].filter(Boolean).join(" ") : "";
  return (
    <div className="min-w-0 flex-1 px-3">
      {shown && text && (
        <p
          key={shown.shownAt}
          title={full}
          className="truncate text-sm text-gray-700 animate-[fade-slide-in_220ms_ease] motion-reduce:animate-none dark:text-gray-200"
        >
          {text.headline && (
            <span
              className={`mr-2 font-heading text-xs font-bold uppercase tracking-wider ${HEADLINE_CLASS[text.side]}`}
            >
              {text.headline}
            </span>
          )}
          {text.line}
        </p>
      )}
      <p role="status" className="sr-only">
        {shown?.priority === "key" ? full : ""}
      </p>
    </div>
  );
}
