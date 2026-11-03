import { useTranslation } from "react-i18next";
import { ChevronLeft, Radio } from "lucide-react";
import { phaseLabel } from "../../../../components/match/helpers";
import type { ClubRef } from "../../../api";
import type { LiveSide, OnlineMatchState } from "../../../convert/matchState";
import LeagueClubCrest from "../../LeagueClubCrest";
import { useGuardedNavigate } from "../../leaveGuard";
import type { LiveMatchData } from "../useLiveMatch";
import { FOCUS } from "./PhoneSheet";

const sideKey = (side: "Home" | "Away") => (side === "Home" ? "home" : "away");

/** One side of the score: its name and crest, the coach's own in green. */
function Team({ side, mine, end }: { side: LiveSide; mine: boolean; end?: boolean }) {
  const club: ClubRef = { id: side.name, name: side.name };
  return (
    <span
      className={`flex min-w-0 items-center gap-1.5 ${end ? "flex-row-reverse text-right" : ""}`}
    >
      <LeagueClubCrest club={club} mine={mine} className="h-[26px] w-[26px]" />
      <span
        className={`min-w-0 font-heading text-sm font-bold uppercase leading-tight tracking-wide ${mine ? "text-primary-700 dark:text-primary-400" : "text-gray-900 dark:text-white"}`}
      >
        {side.name}
      </span>
    </span>
  );
}

/**
 * The live match's head on a phone (design m-tran-dau): a way out (which asks first, the coach
 * holding the side), the score with the minute as the radar shows it, then who coaches and the
 * server's own minute, which orders count from.
 */
export function PhoneMatchHeader({
  data,
  shown,
}: {
  data: LiveMatchData;
  shown: OnlineMatchState;
}) {
  const { t } = useTranslation();
  const navigate = useGuardedNavigate();
  const { mine, state, everCoached } = data;
  const held = mine ? state.controllers[sideKey(mine.side)] === "Manager" : false;
  const chip =
    mine === null
      ? t("match.spectatorMode")
      : held
        ? t("online.match.phone.youCoach")
        : everCoached
          ? t("online.match.phone.aiCoaches")
          : t("online.match.takingCharge");
  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 pb-2 pl-1 pr-2 pt-[calc(0.375rem+var(--safe-top))] backdrop-blur dark:border-navy-700 dark:bg-navy-800/95">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate("/online")}
          aria-label={t("online.match.phone.leave")}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-700 dark:text-gray-200 ${FOCUS}`}
        >
          <ChevronLeft className="h-5.5 w-5.5" aria-hidden="true" />
        </button>
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <Team side={shown.home} mine={mine?.side === "Home"} end />
          <span className="flex flex-col items-center gap-px">
            <span className="whitespace-nowrap font-heading text-[28px] font-bold leading-none tabular-nums text-gray-900 dark:text-white">
              {`${shown.homeScore} – ${shown.awayScore}`}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold tabular-nums text-accent-700 dark:text-accent-400">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-red-500 motion-safe:animate-pulse"
              />
              {`${phaseLabel(shown.phase, t)} · ${shown.minute}'`}
            </span>
            <span className="sr-only">
              {t("online.match.scoreLine", {
                home: shown.home.name,
                away: shown.away.name,
                homeScore: shown.homeScore,
                awayScore: shown.awayScore,
              })}
            </span>
          </span>
          <Team side={shown.away} mine={mine?.side === "Away"} />
        </div>
        <span className="w-2 shrink-0" />
      </div>
      <div className="ml-2 mr-1 mt-1.5 flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
        <span
          className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 font-semibold ${held ? "bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300" : "bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-300"}`}
        >
          <Radio className="h-3 w-3" aria-hidden="true" />
          {chip}
        </span>
        {mine && (
          <span className="min-w-0 flex-1 truncate">
            {t("online.match.phone.ordersFrom", { minute: state.minute })}
          </span>
        )}
      </div>
    </header>
  );
}
