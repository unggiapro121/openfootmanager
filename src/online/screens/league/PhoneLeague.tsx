import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import type { LeagueView } from "../../api";
import { online } from "../../client";
import { currentRound, LEAGUE_ROUNDS } from "../../fixtures";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import { useCountdownText } from "../useCountdownText";
import { recentForm } from "./leagueView";
import { FOCUS } from "./phoneLeagueLook";
import PhoneLeagueRounds from "./PhoneLeagueRounds";
import PhoneLeagueStats from "./PhoneLeagueStats";
import PhoneLeagueTable from "./PhoneLeagueTable";
import { onTablistKeyDown, tabIndexOf } from "../mobile/tablistKeys";

const KEY = "online.league.phone";
/** Fixtures of a whole league season: 26 rounds of seven. */
const SEASON_FIXTURES = 182;
/** How many results the table's form column shows. */
const FORM_ROUNDS = 2;

type Tab = "table" | "rounds" | "stats";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "table", label: `${KEY}.tabTable` },
  { id: "rounds", label: `${KEY}.tabRounds` },
  { id: "stats", label: `${KEY}.tabStats` },
];

/**
 * The league on a phone (design m-giai-dau): a card with the club's rank, points and the next
 * kick-off, the season's progress, then the table, the rounds and the leaders under three tabs.
 */
export default function PhoneLeague({ league }: { league: LeagueView }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("table");
  const club = useOnlineStore((state) => state.club);
  const myClubId = club?.club.id ?? null;
  const form = useRecentForm(league);

  return (
    <div className="-mx-3 -mt-3 flex flex-col">
      <LeagueSummary
        league={league}
        myClubId={myClubId}
        nextKickoff={club?.nextFixture?.kickoffAt}
      />
      <div
        role="tablist"
        onKeyDown={onTablistKeyDown}
        aria-label={t(`${KEY}.tabs`)}
        className="sticky top-[var(--phone-header-h,0px)] z-10 mt-3 grid grid-cols-3 border-b border-gray-200 bg-gray-100 px-4 dark:border-navy-700 dark:bg-navy-900"
      >
        {TABS.map((one) => {
          const on = one.id === tab;
          return (
            <button
              key={one.id}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={tabIndexOf(on)}
              onClick={() => setTab(one.id)}
              className={`-mb-px h-[46px] border-b-2 font-heading text-[15px] font-bold uppercase tracking-wider ${on ? "border-primary-500 text-gray-900 dark:text-white" : "border-transparent text-gray-500 dark:text-gray-400"} ${FOCUS}`}
            >
              {t(one.label)}
            </button>
          );
        })}
      </div>
      <div className="px-4 pb-4 pt-3">
        {tab === "table" && <PhoneLeagueTable league={league} myClubId={myClubId} form={form} />}
        {tab === "rounds" && <PhoneLeagueRounds league={league} myClubId={myClubId} />}
        {tab === "stats" && (
          <PhoneLeagueStats
            leagueId={league.id}
            myClub={club ? { id: club.club.id, name: club.club.name } : null}
          />
        )}
      </div>
    </div>
  );
}

/** The results of the last rounds played, for the form column; none until they are read. */
function useRecentForm(league: LeagueView) {
  const played = currentRound(league.fixturesDone) - 1;
  const rounds = Array.from(
    { length: Math.min(FORM_ROUNDS, played) },
    (_, index) => played - index,
  ).reverse();
  const { resource } = useOnlineResource(
    () => Promise.all(rounds.map((round) => tracked(() => online.leagues.round(league.id, round)))),
    [league.id, played],
  );
  return resource.status === "ready"
    ? recentForm(resource.data.map((view) => view.fixtures))
    : new Map<string, never[]>();
}

const STAT_BOX = "flex flex-col gap-0.5 rounded-[10px] bg-white/70 px-2.5 py-2 dark:bg-navy-900/55";
const STAT_LABEL = "text-[10px] uppercase tracking-widest text-gray-500 dark:text-gray-400";

function LeagueSummary({
  league,
  myClubId,
  nextKickoff,
}: {
  league: LeagueView;
  myClubId: string | null;
  nextKickoff: string | undefined;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const countdown = useCountdownText(nextKickoff);
  const mine = league.table.find((row) => row.club.id === myClubId);
  const gd = mine?.goalDifference ?? 0;
  const share = Math.min(100, (league.fixturesDone / SEASON_FIXTURES) * 100);
  const progress = t("online.league.progress", {
    done: league.fixturesDone,
    total: SEASON_FIXTURES,
  });
  return (
    <section
      aria-labelledby={titleId}
      className="mx-4 mt-3 flex flex-col gap-3 rounded-2xl border border-gray-200 bg-linear-to-br from-primary-50 to-white p-3.5 dark:border-navy-700 dark:from-primary-900/40 dark:to-navy-800"
    >
      <div className="flex items-center gap-3">
        <span
          className="relative flex h-[52px] w-12 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <Shield
            className="absolute inset-0 h-full w-full fill-accent-400 text-accent-500"
            strokeWidth={1}
          />
          <span className="relative font-heading text-lg font-bold text-navy-900">
            {league.level}
          </span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2
            id={titleId}
            className="font-heading text-xl font-bold uppercase leading-tight tracking-wider text-gray-900 dark:text-white"
          >
            {t("online.league.heading", { name: league.name, level: league.level })}
          </h2>
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {t(`${KEY}.summaryLine`, { clubs: league.table.length, rounds: LEAGUE_ROUNDS })}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className={STAT_BOX}>
          <span className={STAT_LABEL}>{t(`${KEY}.rank`)}</span>
          <span className="font-heading text-2xl font-bold leading-none text-primary-700 dark:text-primary-400">
            {mine ? `#${mine.position}` : "—"}
          </span>
        </div>
        <div className={STAT_BOX}>
          <span className={STAT_LABEL}>{t(`${KEY}.points`)}</span>
          <span className="font-heading text-2xl font-bold leading-none text-gray-900 dark:text-white">
            {mine?.points ?? "—"}{" "}
            {mine && (
              <span className="text-[13px] text-gray-500 dark:text-gray-400">
                <span aria-hidden="true">· </span>
                <span>{t(`${KEY}.goalDiff`, { gd: gd > 0 ? `+${gd}` : String(gd) })}</span>
              </span>
            )}
          </span>
        </div>
        <div className={STAT_BOX}>
          <span className={STAT_LABEL}>{t(`${KEY}.nextMatch`)}</span>
          <span
            role="timer"
            aria-live="off"
            className="font-heading text-xl font-bold leading-tight tabular-nums text-accent-700 dark:text-accent-400"
          >
            {countdown ?? "—"}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={SEASON_FIXTURES}
          aria-valuenow={league.fixturesDone}
          aria-label={progress}
          className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700"
        >
          <div className="h-full bg-primary-500" style={{ width: `${share}%` }} />
        </div>
        <span className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
          <span>{progress}</span>
          <span>
            {t(`${KEY}.roundOf`, {
              round: currentRound(league.fixturesDone),
              total: LEAGUE_ROUNDS,
            })}
          </span>
        </span>
      </div>
      {league.rankedPerMatch && (
        <p role="note" className="text-xs text-accent-800 dark:text-accent-400">
          {t("online.league.rankedPerMatch")}
        </p>
      )}
    </section>
  );
}
