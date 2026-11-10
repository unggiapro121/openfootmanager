import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { History, ListOrdered, Star, TrendingUp } from "lucide-react";
import type { MineView, PlayerLine } from "../../../api";
import { type LiveSide, type OnlineMatchState, toRadarRoster } from "../../../convert/matchState";
import { useOnlineStore } from "../../../store/onlineStore";
import { manOfTheMatch, useFixtureLines } from "../../fixtureRatings";
import { FriendlyAfterMatch } from "../../friendly/FriendlyAfterMatch";
import { FOCUS } from "../../mobile/PhoneSheet";
import { verdictOf } from "../OnlineFullTime";
import type { LiveMatchData } from "../useLiveMatch";
import { PhoneMatchHeader } from "./PhoneMatchHeader";
import { PhoneMatchPanels } from "./PhoneMatchPanels";

const KEY = "online.match.phone";

const VERDICT_TEXT = {
  success: "text-primary-700 dark:text-primary-400",
  danger: "text-red-600 dark:text-red-400",
  neutral: "text-gray-700 dark:text-gray-200",
} as const;

const SECONDARY =
  "border border-gray-200 bg-white text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-white";
const ACTION = `inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 font-heading text-sm font-bold uppercase tracking-wider ${FOCUS}`;

/** One line of a side's result: a scorer with their goals' minutes, or a player sent off. */
type ResultLine = { id: string; name: string; minutes: string; sentOff: boolean };

/** `side`'s scorers in the order they first scored, then the players it had sent off. */
function resultLines(
  state: OnlineMatchState,
  side: "Home" | "Away",
  penalty: string,
): ResultLine[] {
  const own: LiveSide = side === "Home" ? state.home : state.away;
  const names = new Map(
    [...own.eleven, ...own.bench].map((player) => [player.id, player.matchName]),
  );
  const nameOf = (id: string) => names.get(id) ?? "–";
  const goals = new Map<string, string[]>();
  const sentOff: ResultLine[] = [];
  for (const event of state.events) {
    if (event.side !== side || !event.player_id) continue;
    if (event.event_type === "Goal" || event.event_type === "PenaltyGoal") {
      const minute = `${event.minute}'${event.event_type === "PenaltyGoal" ? ` (${penalty})` : ""}`;
      goals.set(event.player_id, [...(goals.get(event.player_id) ?? []), minute]);
    } else if (event.event_type === "RedCard" || event.event_type === "SecondYellow") {
      const id = event.player_id;
      sentOff.push({ id, name: nameOf(id), minutes: `${event.minute}'`, sentOff: true });
    }
  }
  return [
    ...[...goals].map(([id, minutes]) => ({
      id,
      name: nameOf(id),
      minutes: minutes.join(", "),
      sentOff: false,
    })),
    ...sentOff,
  ];
}

/** A side's scorers and red cards under the score, the home side's to the left. */
function SideLines({
  side,
  lines,
  end = false,
}: {
  side: LiveSide;
  lines: ResultLine[];
  end?: boolean;
}) {
  const { t } = useTranslation();
  if (lines.length === 0) {
    return <p className={`text-xs text-gray-400 ${end ? "text-right" : ""}`}>–</p>;
  }
  return (
    <ul
      aria-label={t(`${KEY}.scorers`, { team: side.name })}
      className={`flex min-w-0 flex-col gap-0.5 text-xs text-gray-700 dark:text-gray-200 ${end ? "items-end text-right" : ""}`}
    >
      {lines.map((line) => (
        <li key={`${line.id}-${line.sentOff}`} className="flex items-center gap-1">
          {line.sentOff && (
            <span
              role="img"
              aria-label={t("match.eventTypes.RedCard")}
              className="h-3 w-2 shrink-0 rounded-[2px] bg-red-600"
            />
          )}
          <span className="min-w-0 truncate">{`${line.name} ${line.minutes}`}</span>
        </li>
      ))}
    </ul>
  );
}

/** The result in the radar's place (D-FT2): the coach's verdict, the scorers, the man of the match. */
function ResultCard({
  state,
  mine,
  lines,
}: {
  state: OnlineMatchState;
  mine: MineView | null;
  lines: PlayerLine[];
}) {
  const { t } = useTranslation();
  const verdict = verdictOf(state, mine);
  const penalty = t(`${KEY}.penalty`);
  const motm = manOfTheMatch(lines);
  return (
    <div className="mx-3 mt-2.5 rounded-[14px] border border-gray-200 bg-white px-4 py-3.5 dark:border-navy-700 dark:bg-navy-800">
      {verdict && (
        <p
          className={`mb-2.5 text-center font-heading text-[26px] font-bold uppercase leading-none tracking-wider ${VERDICT_TEXT[verdict.variant]}`}
        >
          {t(verdict.key)}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <SideLines side={state.home} lines={resultLines(state, "Home", penalty)} />
        <SideLines side={state.away} lines={resultLines(state, "Away", penalty)} end />
      </div>
      {motm && (
        <p className="mt-3 flex items-center gap-1.5 border-t border-gray-100 pt-2.5 text-xs text-gray-600 dark:border-navy-700 dark:text-gray-300">
          <Star className="h-3.5 w-3.5 shrink-0 text-accent-500" aria-hidden="true" />
          {t("match.motm")}
          <strong className="ml-auto font-semibold text-gray-900 dark:text-white">
            {`${motm.name} · ${motm.rating.toFixed(1)}`}
          </strong>
        </p>
      )}
    </div>
  );
}

/**
 * Full time on a phone (analysis-mobile-fulltime D-FT1): the live match's screen with the result in
 * the radar's place, the events tab open (D-FT4), each player's rating once the server has settled
 * the fixture (D-FT3), and at the foot the way on — the replay and the ratings page, for a coach
 * of either side also his players' progress (C-22b), or a friendly's way back to its room (D-FT6).
 */
export function PhoneFullTime({
  data,
  state,
  onReplay,
}: {
  data: LiveMatchData;
  /** The match as the screen shows it, over. */
  state: OnlineMatchState;
  onReplay: () => void;
}) {
  const { t } = useTranslation();
  const { view, mine } = data;
  const squad = useOnlineStore((store) => store.club?.players);
  const pictures = useOnlineStore((store) => store.playerPictures);
  const roster = useMemo(() => toRadarRoster(state, squad, pictures), [state, squad, pictures]);
  const lines = useFixtureLines(view.fixtureId ?? undefined);
  // A coach of either side of a league match gets his players' progress as the main way on
  // (C-22b, D-PG3); an onlooker keeps the replay and the ratings.
  const coachOfFixture = Boolean(view.fixtureId) && mine !== null;
  const ratings = useMemo(
    () =>
      new Map(lines.filter((line) => line.rating > 0).map((line) => [line.playerId, line.rating])),
    [lines],
  );

  return (
    <section
      aria-label={t("match.matchReport")}
      className="fixed inset-0 z-40 overflow-y-auto bg-gray-100 pb-[calc(5.5rem+var(--safe-bottom))] dark:bg-navy-900"
    >
      <PhoneMatchHeader data={data} shown={state} />
      <ResultCard state={state} mine={mine} lines={lines} />
      <PhoneMatchPanels
        state={state}
        mine={mine}
        roster={roster}
        initialPanel="events"
        ratings={ratings}
      />
      <nav
        aria-label={t(`${KEY}.afterMatch`)}
        className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white/95 px-3 pt-2.5 pb-[calc(0.625rem+var(--safe-bottom))] backdrop-blur dark:border-navy-700 dark:bg-navy-800/95"
      >
        <button type="button" onClick={onReplay} className={`${ACTION} ${SECONDARY}`}>
          <History className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("online.replay.watch")}</span>
        </button>
        {view.fixtureId && (
          <Link
            to={`/online/fixtures/${view.fixtureId}`}
            className={`${ACTION} ${coachOfFixture ? SECONDARY : "bg-primary-700 text-white"}`}
          >
            <ListOrdered className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t(`${KEY}.ratings`)}</span>
          </Link>
        )}
        {coachOfFixture && (
          <Link
            to={`/online/fixtures/${view.fixtureId}/progress`}
            className={`${ACTION} bg-primary-700 text-white`}
          >
            <TrendingUp className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("online.progress.cta")}</span>
          </Link>
        )}
        {view.kind === "friendly" && (
          <FriendlyAfterMatch matchId={view.id} inline coach={mine !== null} />
        )}
      </nav>
    </section>
  );
}
