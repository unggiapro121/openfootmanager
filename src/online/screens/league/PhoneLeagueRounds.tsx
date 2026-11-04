import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ClubRef, FixtureView, LeagueView } from "../../api";
import { online } from "../../client";
import { useOnlineNow } from "../../clock";
import { currentRound, involves, LEAGUE_ROUNDS } from "../../fixtures";
import { formatKickoffClock } from "../../format";
import { tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import LeagueClubCrest from "../LeagueClubCrest";
import ResourceState from "../ResourceState";
import { useCountdownText } from "../useCountdownText";
import { ownFirst, roundState } from "./leagueView";
import { FOCUS } from "./phoneLeagueLook";

const KEY = "online.league.phone";
const STEP =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-gray-200 bg-white text-gray-800 disabled:opacity-40 dark:border-navy-700 dark:bg-navy-800 dark:text-white";

/**
 * The league round by round on a phone (design m-giai-dau): a step back and forth, the 26 rounds
 * as chips (played ones dotted grey, the current gold), then the round's fixtures as cards, the
 * coach's own first. A card opens the fixture, or the match while it is played.
 */
export default function PhoneLeagueRounds({
  league,
  myClubId,
}: {
  league: LeagueView;
  myClubId: string | null;
}) {
  const { t } = useTranslation();
  const current = currentRound(league.fixturesDone);
  const [round, setRound] = useState(current);
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.leagues.round(league.id, round)),
    [league.id, round],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setRound(round - 1)}
          disabled={round <= 1}
          aria-label={t("online.league.previousRound")}
          className={`${STEP} ${FOCUS}`}
        >
          <ChevronLeft className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
        <div className="flex flex-1 flex-col items-center gap-px">
          <span className="font-heading text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-white">
            {t("online.fixture.round", { round })}
          </span>
          {resource.status === "ready" && <RoundStateLine fixtures={resource.data.fixtures} />}
        </div>
        <button
          type="button"
          onClick={() => setRound(round + 1)}
          disabled={round >= LEAGUE_ROUNDS}
          aria-label={t("online.league.nextRound")}
          className={`${STEP} ${FOCUS}`}
        >
          <ChevronRight className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
      </div>
      <div
        role="tablist"
        aria-label={t(`${KEY}.pickRound`)}
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]"
      >
        {Array.from({ length: LEAGUE_ROUNDS }, (_, index) => index + 1).map((n) => (
          <RoundChip key={n} n={n} current={current} on={n === round} onPick={setRound} />
        ))}
      </div>
      <ResourceState resource={resource} reload={reload}>
        {(view) => (
          <ul aria-label={t("online.fixture.round", { round })} className="flex flex-col gap-2">
            {ownFirst(view.fixtures, myClubId).map((fixture) => (
              <FixtureCard key={fixture.id} fixture={fixture} myClubId={myClubId} />
            ))}
          </ul>
        )}
      </ResourceState>
    </div>
  );
}

function RoundChip({
  n,
  current,
  on,
  onPick,
}: {
  n: number;
  current: number;
  on: boolean;
  onPick: (round: number) => void;
}) {
  const tone = on
    ? "border-primary-500 bg-primary-50 text-gray-900 dark:bg-primary-900/40 dark:text-white"
    : n === current
      ? "border-gray-200 bg-white text-accent-700 dark:border-navy-700 dark:bg-navy-800 dark:text-accent-400"
      : "border-gray-200 bg-white text-gray-500 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-400";
  const dot = n < current ? "bg-gray-400 dark:bg-navy-600" : n === current ? "bg-accent-500" : "";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={() => onPick(n)}
      className={`relative h-10 w-10 shrink-0 rounded-[10px] border text-[13px] font-bold ${tone} ${FOCUS}`}
    >
      {n}
      {dot && (
        <span
          aria-hidden="true"
          className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${dot}`}
        />
      )}
    </button>
  );
}

function RoundStateLine({ fixtures }: { fixtures: FixtureView[] }) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const state = roundState(fixtures);
  if (state === "done") {
    return (
      <span className="text-xs text-gray-500 dark:text-gray-400">{t(`${KEY}.roundDone`)}</span>
    );
  }
  if (state === "live") {
    return <span className="text-xs text-red-600 dark:text-red-400">{t(`${KEY}.roundLive`)}</span>;
  }
  const first = fixtures[0];
  return (
    <span className="text-xs text-accent-700 dark:text-accent-400">
      {first
        ? t(`${KEY}.roundUpcoming`, {
            when: formatKickoffClock(first.kickoffAt, now, i18n.language),
          })
        : t(`${KEY}.roundUnplanned`)}
    </span>
  );
}

/** Where a card leads: the match while it is played, the fixture otherwise. */
function cardTarget(fixture: FixtureView): string {
  return fixture.matchStatus === "live" && fixture.matchId
    ? `/online/match/${fixture.matchId}`
    : `/online/fixtures/${fixture.id}`;
}

function FixtureCard({ fixture, myClubId }: { fixture: FixtureView; myClubId: string | null }) {
  const { t } = useTranslation();
  const mine = myClubId !== null && involves(fixture, myClubId);
  return (
    <li>
      <Link
        to={cardTarget(fixture)}
        className={`flex flex-col gap-2 rounded-xl border p-3 ${mine ? "border-primary-300 bg-primary-50 dark:border-primary-800 dark:bg-primary-900/30" : "border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800"} ${FOCUS}`}
      >
        {mine && (
          <span className="self-start rounded bg-primary-100 px-1.5 font-heading text-[11px] font-bold uppercase tracking-wider text-primary-800 dark:bg-primary-900/50 dark:text-primary-300">
            {t(`${KEY}.yourMatch`)}
          </span>
        )}
        <span className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-2">
          <Side club={fixture.home} myClubId={myClubId} end />
          <Middle fixture={fixture} mine={mine} />
          <Side club={fixture.away} myClubId={myClubId} />
        </span>
      </Link>
    </li>
  );
}

function Side({
  club,
  myClubId,
  end = false,
}: {
  club: ClubRef;
  myClubId: string | null;
  end?: boolean;
}) {
  const mine = club.id === myClubId;
  return (
    <span className={`flex min-w-0 items-center gap-2 ${end ? "flex-row-reverse text-right" : ""}`}>
      <LeagueClubCrest club={club} mine={mine} className="h-[26px] w-[26px]" />
      <span
        className={`text-[13px] font-semibold leading-tight ${mine ? "text-primary-700 dark:text-primary-400" : "text-gray-900 dark:text-white"}`}
      >
        {club.name}
      </span>
    </span>
  );
}

/** The score once settled, "live" while played, else the kick-off (a countdown for the coach's own). */
function Middle({ fixture, mine }: { fixture: FixtureView; mine: boolean }) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const countdown = useCountdownText(mine ? fixture.kickoffAt : undefined);
  const big = "font-heading font-bold tabular-nums whitespace-nowrap";
  const sub = "text-[10px] whitespace-nowrap text-gray-500 dark:text-gray-400";
  let main = (
    <span className={`${big} text-lg text-gray-700 dark:text-gray-200`}>
      {formatKickoffClock(fixture.kickoffAt, now, i18n.language)}
    </span>
  );
  let note: string | null = null;
  if (fixture.status === "settled") {
    main = (
      <span
        className={`${big} text-[22px] text-gray-900 dark:text-white`}
      >{`${fixture.homeGoals ?? 0}–${fixture.awayGoals ?? 0}`}</span>
    );
    note = t(`${KEY}.fullTime`);
  } else if (fixture.status === "void") {
    main = (
      <span className={`${big} text-[15px] text-gray-500 dark:text-gray-400`}>
        {t(`${KEY}.void`)}
      </span>
    );
  } else if (fixture.matchStatus === "live") {
    main = (
      <span className={`${big} text-[15px] text-red-600 dark:text-red-400`}>
        {t(`${KEY}.live`)}
      </span>
    );
  } else if (countdown) {
    main = (
      <span className={`${big} text-xl text-accent-700 dark:text-accent-400`}>{countdown}</span>
    );
    note = t("online.overview.kickoffIn");
  }
  return (
    <span className="flex flex-col items-center gap-px">
      {main}
      {note && <span className={sub}>{note}</span>}
    </span>
  );
}
