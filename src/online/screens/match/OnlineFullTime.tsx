import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";
import { Badge, Button } from "../../../components/ui";
import type { MineView } from "../../api";
import type { OnlineMatchState } from "../../convert/matchState";
import { Scoreboard } from "./MatchBoard";
import { MatchReview } from "./MatchReview";

/** The viewer's result: a win, a draw or a defeat of their side; none for a spectator. */
function verdictOf(state: OnlineMatchState, mine: MineView | null) {
  if (mine === null) return null;
  const own = mine.side === "Home" ? state.homeScore : state.awayScore;
  const other = mine.side === "Home" ? state.awayScore : state.homeScore;
  if (own > other) return { key: "match.victory", variant: "success" } as const;
  if (own < other) return { key: "match.defeat", variant: "danger" } as const;
  return { key: "match.draw", variant: "neutral" } as const;
}

/**
 * The match report of a live online match once the referee has blown for full time (C-2 §3.6): in
 * place of the radar, whose players would go on standing about, the score, the viewer's result,
 * the key events, the stats and the line-ups, the way on (`strip`: a league match's result, a
 * friendly's rematch) and a way to watch it again.
 */
export function OnlineFullTime({
  state,
  mine,
  strip,
  onReplay,
}: {
  state: OnlineMatchState;
  mine: MineView | null;
  /** The full-time line and its way on. */
  strip: ReactNode;
  onReplay: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const verdict = verdictOf(state, mine);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <Scoreboard state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <h2
          id={titleId}
          className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {t("match.matchReport")}
        </h2>
        {verdict && <Badge variant={verdict.variant}>{t(verdict.key)}</Badge>}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          icon={<History aria-hidden="true" />}
          onClick={onReplay}
        >
          {t("online.replay.watch")}
        </Button>
      </div>
      {strip}
      <div className="flex flex-wrap items-start gap-4">
        <MatchReview state={state} title={t("match.keyEvents")} />
      </div>
    </section>
  );
}
