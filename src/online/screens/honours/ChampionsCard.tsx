import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, CardBody, CardHeader } from "../../../components/ui";
import { online } from "../../client";
import { tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import { TrophyIcon } from "./TrophyIcon";
import { shownCoachName } from "../coachName";

const LINK =
  "rounded font-semibold text-gray-900 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-gray-100 dark:focus:ring-offset-navy-800";

/**
 * The champions of the league's level, every closed season, newest first (C20-5). Nothing shows
 * until a season has closed, or when the server cannot say.
 */
export default function ChampionsCard({ leagueId, level }: { leagueId: string; level: number }) {
  const { t } = useTranslation();
  const { resource } = useOnlineResource(
    () => tracked(() => online.leagues.champions(leagueId)),
    [leagueId],
  );
  if (resource.status !== "ready" || resource.data.champions.length === 0) return null;

  return (
    <Card>
      <CardHeader>{t("online.honours.championsTitle", { level })}</CardHeader>
      <CardBody>
        <ul aria-label={t("online.honours.championsTitle", { level })} className="space-y-2">
          {resource.data.champions.map((title) => (
            <li key={title.id} className="flex items-center gap-3 text-sm">
              <TrophyIcon level={title.place.level} className="h-6 w-6 shrink-0" />
              <span className="w-20 shrink-0 text-gray-500 dark:text-gray-400">
                {t("online.honours.season", { season: title.place.seasonNumber })}
              </span>
              <Link to={`/online/clubs/${title.club.id}/honours`} className={LINK}>
                {title.club.name}
              </Link>
              <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                {title.coach ? shownCoachName(t, title.coach.name) : t("online.honours.aiCoach")}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
