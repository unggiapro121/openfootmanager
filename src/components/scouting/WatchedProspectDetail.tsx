import { useTranslation } from "react-i18next";

import { countryName } from "../../lib/countries";
import { formatPlayerWageLine } from "../../lib/finance";
import { calcAge, formatVal, formatWeeklyAmount } from "../../lib/helpers";
import type { ScoutReportData, WatchedProspect } from "../../store/types";
import DashboardModalFrame from "../dashboard/DashboardModalFrame";
import { Badge, Button, CountryFlag } from "../ui";
import ProspectAttributeGroups from "./ProspectAttributeGroups";
import ProspectPhysique from "./ProspectPhysique";

interface WatchedProspectDetailProps {
  entry: WatchedProspect;
  report: ScoutReportData;
  scoutName: string | null;
  busy: boolean;
  onSign: () => void;
  onUnwatch: () => void;
  onClose: () => void;
}

/**
 * A watched youngster laid out as a player profile, from his scouts' latest
 * read only: his build, what they make of his overall and potential, and every
 * attribute — the figure for those read, "??" for the rest. His true ratings
 * are never shown.
 */
export default function WatchedProspectDetail({
  entry,
  report,
  scoutName,
  busy,
  onSign,
  onUnwatch,
  onClose,
}: WatchedProspectDetailProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const weeklySuffix = t("finances.perWeekSuffix");

  return (
    <DashboardModalFrame maxWidthClassName="max-w-3xl">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={report.player_name}
        className="max-h-[80vh] space-y-5 overflow-y-auto"
      >
        <div>
          <h3 className="text-2xl font-heading font-bold uppercase tracking-wide text-gray-900 dark:text-gray-100">
            {report.player_name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
            <span>{t(`common.positions.${report.position}`, report.position)}</span>
            <span className="inline-flex items-center gap-1">
              <CountryFlag
                code={report.nationality}
                locale={language}
                className="text-xs leading-none"
              />
              {countryName(report.nationality, language)}
            </span>
            <span>
              {t("common.age")} {calcAge(report.dob)}
            </span>
          </div>
        </div>

        <ProspectPhysique report={report} />

        <div className="flex flex-wrap gap-2">
          <Badge variant={entry.signed_by ? "neutral" : "success"} size="sm">
            {`${t("scouting.watchlistStatus")}: ${entry.signed_by ?? t("scouting.watchlistStatusFree")}`}
          </Badge>
          {report.avg_rating !== null ? (
            <Badge variant="neutral" size="sm">
              {`${t(report.rating_key)} (~${report.avg_rating})`}
            </Badge>
          ) : null}
          <Badge variant="neutral" size="sm">
            {t(report.potential_key)}
          </Badge>
          <Badge variant="neutral" size="sm">
            {`${t("scouting.confidence")}: ${t(report.confidence_key)}`}
          </Badge>
          <Badge variant="neutral" size="sm">
            {`${t("scouting.watchlistScout")}: ${scoutName ?? t("scouting.watchlistNoScout")}`}
          </Badge>
          <Badge variant="neutral" size="sm">
            {t("scouting.watchlistWeeksFollowed", { weeks: entry.weeks_followed ?? 0 })}
          </Badge>
          <Badge variant="neutral" size="sm">
            {t("finances.wagePerWeek")}:{" "}
            {formatPlayerWageLine(
              entry.prospect,
              (amount) => formatWeeklyAmount(formatVal(amount), weeklySuffix),
              t,
            )}
          </Badge>
        </div>

        <ProspectAttributeGroups
          reads={report.attribute_reads ?? []}
          isKeeper={report.position === "Goalkeeper"}
        />

        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" disabled={busy || Boolean(entry.signed_by)} onClick={onSign}>
            {t("scouting.watchlistSign")}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onUnwatch}>
            {t("scouting.watchlistUnwatch")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
