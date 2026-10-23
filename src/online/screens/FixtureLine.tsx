import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { ClubRef, FixtureView } from "../api";
import { formatMoment } from "../format";

const LINK_CLASS =
  "rounded hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800";

function ClubLink({ club, mine }: { club: ClubRef; mine: boolean }) {
  return (
    <Link
      to={`/online/clubs/${club.id}`}
      className={`${LINK_CLASS} ${mine ? "font-bold text-primary-600 dark:text-primary-400" : ""}`}
    >
      {club.name}
    </Link>
  );
}

/**
 * One fixture of an online league: the clubs, then the score once settled (opening the result),
 * a way into the match while it is played (C-2 §3.6), or the kick-off time before (C-2 §3.5).
 */
export default function FixtureLine({
  fixture,
  myClubId,
}: {
  fixture: FixtureView;
  myClubId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const settled = fixture.status === "settled";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 py-2 text-sm text-gray-700 last:border-b-0 dark:border-navy-600 dark:text-gray-300">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <ClubLink club={fixture.home} mine={fixture.home.id === myClubId} />
        <span className="text-gray-400">–</span>
        <ClubLink club={fixture.away} mine={fixture.away.id === myClubId} />
      </span>
      {settled ? (
        <Link
          to={`/online/fixtures/${fixture.id}`}
          aria-label={t("online.fixture.openResult", {
            home: fixture.home.name,
            away: fixture.away.name,
          })}
          className={`${LINK_CLASS} font-heading font-bold tabular-nums text-gray-900 dark:text-gray-100`}
        >
          {fixture.homeGoals} – {fixture.awayGoals}
        </Link>
      ) : fixture.matchId && fixture.matchStatus === "live" ? (
        <Link
          to={`/online/match/${fixture.matchId}`}
          aria-label={t("online.fixture.watchMatch", {
            home: fixture.home.name,
            away: fixture.away.name,
          })}
          className={`${LINK_CLASS} text-xs font-semibold text-red-600 dark:text-red-400`}
        >
          {t("online.fixture.watchLive")}
        </Link>
      ) : (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {fixture.status === "void"
            ? t("online.fixture.void")
            : formatMoment(fixture.kickoffAt, i18n.language)}
        </span>
      )}
    </li>
  );
}
