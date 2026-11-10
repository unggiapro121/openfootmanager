import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { FixtureView } from "../../api";

/** A fixture still to play, as a link to its opponent's profile for that fixture (C-23a §6.1). */
export function OpponentFixtureLink({
  fixture,
  clubId,
  className,
}: {
  fixture: FixtureView;
  clubId: string;
  className: string;
}) {
  const { t } = useTranslation();
  const opponent = fixture.home.id === clubId ? fixture.away : fixture.home;
  return (
    <Link
      to={`/online/clubs/${opponent.id}/opponent?fixture=${fixture.id}`}
      aria-label={t("online.opponent.linkLabel", { club: opponent.name })}
      className={className}
    >
      {t("online.opponent.link")}
    </Link>
  );
}
