import { useTranslation } from "react-i18next";
import { Badge, Card, CardBody, CardHeader } from "../../components/ui";
import { useOnlineStore } from "../store/onlineStore";
import { SEASON_DAYS } from "./OnlineHeader";
import { useCountdownText } from "./useCountdownText";

/** The season as the coach's region lives it: its number, its state, today's day. */
export default function SeasonCard() {
  const { t } = useTranslation();
  const season = useOnlineStore((state) => state.season);
  const nextDay = useCountdownText(season?.nextDayAt);

  return (
    <Card accent="primary">
      <CardHeader
        action={
          season && (
            <Badge variant="primary" size="sm">
              {t(`online.season.status.${season.status}`, season.status)}
            </Badge>
          )
        }
      >
        {season ? t("online.header.season", { number: season.number }) : t("online.season.title")}
      </CardHeader>
      <CardBody className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
        {season ? (
          <>
            {season.day !== undefined && (
              <p className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100">
                {t("online.season.day", { day: season.day + 1, total: SEASON_DAYS })}
              </p>
            )}
            <p>{t("online.season.footballYear", { year: season.footballYear })}</p>
            {nextDay && <p>{t("online.season.nextDay", { time: nextDay })}</p>}
          </>
        ) : (
          <p>{t("online.season.none")}</p>
        )}
      </CardBody>
    </Card>
  );
}
