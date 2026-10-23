import { useTranslation } from "react-i18next";
import { Card, CardBody, CardHeader } from "../../components/ui";
import type { FixtureView } from "../api";
import { deviceDiffersFromRegion, formatMoment, formatRegionClock } from "../format";
import { useOnlineStore } from "../store/onlineStore";
import { useCountdownText } from "./useCountdownText";

/** The club's next match: the opponent, the kick-off, the time left (C-2 §3.3). */
export default function NextFixtureCard() {
  const { t, i18n } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  const fixture = club?.nextFixture;
  const countdown = useCountdownText(fixture?.kickoffAt);

  return (
    <Card accent="accent">
      <CardHeader>{t("online.fixture.title")}</CardHeader>
      <CardBody className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
        {club && fixture ? (
          <FixtureLines
            fixture={fixture}
            clubId={club.club.id}
            region={club.club.region}
            language={i18n.language}
            countdown={countdown}
          />
        ) : (
          <p>{t("online.fixture.none")}</p>
        )}
      </CardBody>
    </Card>
  );
}

interface FixtureLinesProps {
  fixture: FixtureView;
  clubId: string;
  region: string;
  language: string;
  countdown: string | null;
}

function FixtureLines({ fixture, clubId, region, language, countdown }: FixtureLinesProps) {
  const { t } = useTranslation();
  const atHome = fixture.home.id === clubId;
  const opponent = atHome ? fixture.away : fixture.home;

  return (
    <>
      <p className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100">
        {t("online.fixture.versus", { club: opponent.name })}
      </p>
      <p>
        {atHome ? t("online.fixture.home") : t("online.fixture.away")} ·{" "}
        {t("online.fixture.round", { round: fixture.round })}
      </p>
      <p>{t("online.fixture.kickoff", { time: formatMoment(fixture.kickoffAt, language) })}</p>
      {deviceDiffersFromRegion(region, fixture.kickoffAt) && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.fixture.regionTime", {
            time: formatRegionClock(fixture.kickoffAt, region, language),
            region: t(`coach.regions.${region}`),
          })}
        </p>
      )}
      {fixture.status === "prepared" ? (
        <p className="font-semibold text-accent-600 dark:text-accent-400">
          {t("online.fixture.prepared")}
        </p>
      ) : (
        countdown && (
          <p className="font-semibold text-primary-600 dark:text-primary-400">
            {t("online.fixture.countdown", { time: countdown })}
          </p>
        )
      )}
    </>
  );
}
