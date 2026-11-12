// The opponent profile's blocks (C-23a §6.2): what both the desktop page and the phone's folding
// cards draw inside their frames.

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { translatePositionAbbreviation } from "../../../components/squad/SquadTab.helpers";
import type {
  AbsenceView,
  FixtureView,
  FormMatchView,
  LastLineupView,
  NotablePlayersView,
  OpponentView,
  ProjectedPlayer,
} from "../../api";
import { formatMoment } from "../../format";
import { OUTCOME_CLASS } from "../OnlineSchedule";
import { LineupPitch } from "./LineupPitch";
import { formatTenth, perMatch, totals } from "./opponentView";
import { LINK, PlayerLink, useMyClub } from "./PlayerLink";

export const MUTED = "text-sm text-gray-600 dark:text-gray-300";
const TAG =
  "rounded-full bg-gray-100 px-2 py-px text-[11px] font-semibold text-gray-600 dark:bg-navy-600 dark:text-gray-300";

function Flags({
  previousSeason,
  previousCoach,
}: {
  previousSeason: boolean;
  previousCoach: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {previousSeason && <span className={TAG}>{t("online.opponent.previousSeason")}</span>}
      {previousCoach && <span className={TAG}>{t("online.opponent.previousCoach")}</span>}
    </>
  );
}

function OutcomeSquare({ outcome }: { outcome: string }) {
  const { t } = useTranslation();
  const known = outcome === "W" || outcome === "D" || outcome === "L" ? outcome : null;
  if (!known) return <span aria-hidden="true" className="h-6 w-6 shrink-0" />;
  return (
    <span
      role="img"
      aria-label={t(`online.schedule.outcome.${known}`)}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded font-heading text-[10px] font-bold text-white ${OUTCOME_CLASS[known]}`}
    >
      {t(`online.schedule.outcomeShort.${known}`)}
    </span>
  );
}

/** One played match from the club's side: its result, score, opponent, venue and labels. */
function MatchLine({ match, lead }: { match: FormMatchView; lead?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <OutcomeSquare outcome={match.outcome} />
      {lead}
      <Link
        to={`/online/fixtures/${match.fixtureId}`}
        className={`${LINK} font-heading tabular-nums`}
      >
        {match.goalsFor} – {match.goalsAgainst}
      </Link>
      <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-100">
        {match.opponent.name}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {match.home ? t("online.overview.homeMark") : t("online.overview.awayMark")}
      </span>
      <Flags previousSeason={match.previousSeason} previousCoach={match.previousCoach} />
    </li>
  );
}

/**
 * (a) Who the club is: where it plays, who runs it, where it stands, the shape it has saved, and
 * when the coach meets it next.
 */
export function HeaderBlock({ view, next }: { view: OpponentView; next: FixtureView | null }) {
  const { t, i18n } = useTranslation();
  const myClub = useMyClub();
  const atHome = next ? next.home.id === myClub?.club.id : false;
  return (
    <div className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
      <p>
        {view.club.city} · {t(`coach.regions.${view.club.region}`)}
      </p>
      {view.league && (
        <p className="font-semibold text-gray-900 dark:text-gray-100">
          {t("online.opponent.leagueLine", {
            league: view.league.name,
            position: view.league.position,
            points: view.league.points,
            played: view.league.played,
          })}
        </p>
      )}
      <p>
        {view.coach
          ? t("online.publicClub.coach", { name: view.coach.fullName })
          : t("online.publicClub.botCoach")}
      </p>
      <p>{t("online.opponent.savedFormation", { formation: view.savedFormation })}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{t("online.opponent.mayChange")}</p>
      {next && (
        <p className="flex flex-wrap gap-x-3 text-xs text-gray-600 dark:text-gray-300">
          <span className="font-semibold">
            {atHome ? t("online.fixture.home") : t("online.fixture.away")}
          </span>
          <span>
            {t("online.opponent.kickoff", { time: formatMoment(next.kickoffAt, i18n.language) })}
          </span>
          {next.lineupLocksAt && (
            <span>
              {t("online.opponent.locksAt", {
                time: formatMoment(next.lineupLocksAt, i18n.language),
              })}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** (b) The last matches, goals a match, and the season at home and away. */
export function FormBlock({ view }: { view: OpponentView }) {
  const { t, i18n } = useTranslation();
  const average = perMatch(view.form);
  const venues = [
    { label: t("online.fixture.home"), line: view.record.home },
    { label: t("online.fixture.away"), line: view.record.away },
  ];
  return (
    <div className="space-y-3">
      {view.form.length === 0 ? (
        <p className={MUTED}>{t("online.opponent.noMatches")}</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-navy-600">
          {view.form.map((match) => (
            <MatchLine key={match.fixtureId} match={match} />
          ))}
        </ul>
      )}
      {average && (
        <p className={MUTED}>
          {t("online.opponent.averages", {
            scored: formatTenth(average.scored, i18n.language),
            conceded: formatTenth(average.conceded, i18n.language),
          })}
        </p>
      )}
      <div>
        <p className="font-heading text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t("online.opponent.record")}
        </p>
        <dl className="mt-1 space-y-1 text-sm">
          {venues.map(({ label, line }) => (
            <div key={label} className="flex flex-wrap gap-x-2">
              <dt className="w-20 shrink-0 font-semibold text-gray-800 dark:text-gray-100">
                {label}
              </dt>
              <dd className="text-gray-700 dark:text-gray-300">
                {t("online.opponent.recordLine", {
                  played: line.played,
                  won: line.won,
                  drawn: line.drawn,
                  lost: line.lost,
                  scored: line.goalsFor,
                  conceded: line.goalsAgainst,
                })}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** (c) Every match between the two clubs, newest first, with the results summed up. */
export function HeadToHeadBlock({ view }: { view: OpponentView }) {
  const { t } = useTranslation();
  if (view.headToHead.length === 0) {
    return <p className={MUTED}>{t("online.opponent.neverMet")}</p>;
  }
  const sum = totals(view.headToHead);
  return (
    <div className="space-y-2">
      <p className="font-semibold text-gray-900 dark:text-gray-100">
        {t("online.opponent.headToHeadTotal", { club: view.club.name, ...sum })}
      </p>
      <ul className="divide-y divide-gray-100 dark:divide-navy-600">
        {view.headToHead.map((match) => (
          <MatchLine
            key={match.fixtureId}
            match={match}
            lead={
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("online.opponent.season", { season: match.seasonNumber })}
              </span>
            }
          />
        ))}
      </ul>
    </div>
  );
}

function SideList({ players }: { players: ProjectedPlayer[] }) {
  const { t } = useTranslation();
  return (
    <ol className="space-y-1 text-sm">
      {players.map((player) => (
        <li key={player.id} className="flex items-center gap-2">
          <span className="w-6 shrink-0 text-right tabular-nums text-gray-500 dark:text-gray-400">
            {player.shirtNumber ?? "–"}
          </span>
          <span className="w-10 shrink-0 text-xs text-gray-500 dark:text-gray-400">
            {translatePositionAbbreviation(t, player.position)}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <PlayerLink id={player.id}>{player.matchName}</PlayerLink>
          </span>
          <span className="font-heading font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {player.ovr}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A side's eleven in slot order and its bench. */
export function splitSide(players: readonly ProjectedPlayer[]) {
  const eleven = players
    .filter((player) => player.onPitch)
    .sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0));
  return { eleven, bench: players.filter((player) => !player.onPitch) };
}

/** A side as it lined up: on a phone its pitch, upright; on a desktop the eleven as a list. */
export function SideLineup({
  players,
  formation,
  pitch,
}: {
  players: readonly ProjectedPlayer[];
  formation: string;
  pitch: boolean;
}) {
  const { t } = useTranslation();
  const { eleven, bench } = splitSide(players);
  return (
    <div className="space-y-3">
      {pitch ? (
        <LineupPitch eleven={eleven} formation={formation} />
      ) : (
        <SideList players={eleven} />
      )}
      {bench.length > 0 && (
        <div>
          <p className="font-heading text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t("match.bench")}
          </p>
          <SideList players={bench} />
        </div>
      )}
    </div>
  );
}

/** (d) The eleven the club put out in its last match, each at his OVR on that day. */
export function LastLineupBlock({
  lineup,
  pitch,
}: {
  lineup: LastLineupView | undefined;
  pitch: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (!lineup) return <p className={MUTED}>{t("online.opponent.noLineup")}</p>;
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        {t("online.opponent.lastLineupMeta", {
          formation: lineup.side.formation,
          style: t(`common.playStyles.${lineup.side.playStyle}`),
          date: formatMoment(lineup.kickoffAt, i18n.language),
        })}
        <Flags previousSeason={lineup.previousSeason} previousCoach={lineup.previousCoach} />
      </p>
      <SideLineup players={lineup.side.players} formation={lineup.side.formation} pitch={pitch} />
    </div>
  );
}

/** (f) The club's top scorer, top assister and best-rated player this season. */
export function NotableBlock({ notable }: { notable: NotablePlayersView }) {
  const { t, i18n } = useTranslation();
  const rows = (["goals", "assists", "rating"] as const).flatMap((kind) => {
    const player = notable[kind];
    return player ? [{ kind, player }] : [];
  });
  if (rows.length === 0) return <p className={MUTED}>{t("online.opponent.noNotable")}</p>;
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(({ kind, player }) => (
        <div key={kind} className="flex flex-wrap items-baseline gap-x-3">
          <dt className="w-36 shrink-0 text-gray-500 dark:text-gray-400">
            {t(`online.opponent.${kind}`)}
          </dt>
          <dd className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <PlayerLink id={player.playerId}>{player.name}</PlayerLink>
            <span className="text-gray-700 dark:text-gray-300">
              {t("online.opponent.notableValue", {
                value: formatTenth(player.value, i18n.language),
                appearances: player.appearances,
              })}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** (g) Who is out: hurt, or banned for a number of matches. How long a hurt man is out is not told. */
export function AbsencesBlock({
  absences,
  named = true,
}: {
  absences: readonly AbsenceView[];
  /** False on the player's own page, where every line is about him. */
  named?: boolean;
}) {
  const { t } = useTranslation();
  if (absences.length === 0)
    return (
      <p className={MUTED}>{named ? t("online.opponent.none") : t("online.publicPlayer.notOut")}</p>
    );
  return (
    <ul className="space-y-1.5 text-sm">
      {absences.map((absence) => (
        <li key={`${absence.playerId}-${absence.kind}`} className="flex flex-wrap gap-x-2">
          {named && (
            <>
              <PlayerLink id={absence.playerId}>{absence.name}</PlayerLink>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {translatePositionAbbreviation(t, absence.naturalPosition)}
              </span>
            </>
          )}
          <span className="text-gray-700 dark:text-gray-300">
            {absence.kind === "injured"
              ? t("online.opponent.injured")
              : t("online.opponent.suspended", { matches: absence.matchesLeft ?? 0 })}
          </span>
        </li>
      ))}
    </ul>
  );
}
