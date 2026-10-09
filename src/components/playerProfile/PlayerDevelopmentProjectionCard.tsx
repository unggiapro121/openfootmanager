import type { PlayerProjection, ProjectionPoint } from "../../store/types";
import { Card, CardBody, CardHeader } from "../ui";
import PlayerDevelopmentProjectionChart from "./PlayerDevelopmentProjectionChart";

type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

/** The backend's answer when the club has nobody to judge its players. */
const NO_ASSESSOR = "be.error.projection.noAssessor";

/** How many coming seasons the card spells out; the chart shows the rest. */
const SEASONS_SPELLED_OUT = 3;

interface PlayerDevelopmentProjectionCardProps {
  projection: PlayerProjection | null;
  /** The backend's reason when there is no projection, as a translation key. */
  error: string | null;
  t: TranslateFn;
}

/**
 * Where the club's scouts expect a player to go: their read of his ceiling,
 * and his overall season by season under the reference conditions, which the
 * card states so the manager can tell why reality runs ahead or behind.
 */
export default function PlayerDevelopmentProjectionCard({
  projection,
  error,
  t,
}: PlayerDevelopmentProjectionCardProps) {
  if (error === NO_ASSESSOR) {
    return (
      <Card>
        <CardHeader>{t("playerProfile.projection.title")}</CardHeader>
        <CardBody>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t("playerProfile.projection.noAssessor")}
          </p>
        </CardBody>
      </Card>
    );
  }
  if (!projection) {
    return null;
  }

  const { estimate, assessor, reference } = projection;
  const { points, peak_expected: peakOvr, peak_age: peakAge } = projection.projection;
  const coming = points.filter((point) => point.season > 0).slice(0, SEASONS_SPELLED_OUT);

  return (
    <Card>
      <CardHeader
        action={
          assessor ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t("playerProfile.projection.assessedBy", { name: assessor.name })}
            </span>
          ) : undefined
        }
      >
        {t("playerProfile.projection.title")}
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <ProjectionBox
            label={t("playerProfile.projection.estimatedPotential")}
            value={`${estimate.potential_low}–${estimate.potential_high}`}
          />
          {coming.map((point) => (
            <SeasonBox key={point.season} point={point} t={t} />
          ))}
          <ProjectionBox
            label={t("playerProfile.projection.expectedPeak")}
            value={t("playerProfile.projection.peakValue", { ovr: peakOvr, age: peakAge })}
          />
        </div>

        <div className="mt-4">
          <PlayerDevelopmentProjectionChart
            points={points}
            expectedLabel={t("playerProfile.projection.expected")}
            rangeLabel={t("playerProfile.projection.range")}
            ageLabel={t("common.age")}
          />
        </div>

        <div className="mt-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>
            {t("playerProfile.projection.assumptions", {
              rating: (reference.match_form / 10).toFixed(1),
            })}
          </p>
          <p>
            {t(
              reference.coaching === "Club"
                ? "playerProfile.projection.coachingClub"
                : "playerProfile.projection.coachingStandard",
            )}
          </p>
          <p className="italic">{t("playerProfile.projection.disclaimer")}</p>
        </div>
      </CardBody>
    </Card>
  );
}

function SeasonBox({ point, t }: { point: ProjectionPoint; t: TranslateFn }) {
  return (
    <ProjectionBox
      label={t("playerProfile.projection.seasonAhead", { n: point.season, age: point.age })}
      value={String(point.expected)}
      detail={`${point.low}–${point.high}`}
    />
  );
}

function ProjectionBox({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="text-center p-2.5 bg-gray-50 dark:bg-navy-700 rounded-lg">
      <p className="font-heading font-bold text-lg text-gray-800 dark:text-gray-100 tabular-nums">
        {value}
      </p>
      {detail ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{detail}</p>
      ) : null}
      <p className="text-xs text-gray-400 dark:text-gray-500 font-heading uppercase tracking-wider">
        {label}
      </p>
    </div>
  );
}
