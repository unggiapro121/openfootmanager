import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Card, CardBody, CardHeader } from "../../../../components/ui";
import type { OpponentReportView } from "../../../api";
import { formatMoment } from "../../../format";
import ResourceState from "../../ResourceState";
import { LINK } from "../PlayerLink";
import ReportContent from "./ReportContent";
import { reportHref } from "./reportParts";
import ReportPlayerCard from "./ReportPlayerCard";
import { useReport } from "./useReport";

/**
 * One report of the club on its own page (C-24b): from the mail that it is back, a played match
 * (`OnlineFixture`) or the notice in the corner. The opponent, the kick-off and, once it has
 * passed, that the match was played; then the report as the profile's block shows it, read-only.
 */
export default function OnlineOpponentReport() {
  const { reportId = "" } = useParams();
  const { resource, reload } = useReport(reportId);
  return (
    <ResourceState resource={resource} reload={reload}>
      {(report) => <ReportPage report={report} />}
    </ResourceState>
  );
}

function ReportPage({ report }: { report: OpponentReportView }) {
  const { t, i18n } = useTranslation();
  const played = Date.parse(report.kickoffAt) <= Date.now();
  return (
    <Card accent="primary">
      <CardHeader>
        {t("online.opponentReport.pageTitle", { club: report.opponent.name })}
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
          <span>{formatMoment(report.kickoffAt, i18n.language)}</span>
          {played && (
            <span className="font-semibold text-gray-800 dark:text-gray-100">
              {t("online.opponentReport.played")}
            </span>
          )}
          {!played && (
            <Link
              to={`/online/clubs/${report.opponent.id}/opponent?fixture=${report.fixtureId}`}
              className={LINK}
            >
              {t("online.opponent.open")}
            </Link>
          )}
        </p>
        {report.content ? (
          <ReportContent report={report} content={report.content} />
        ) : (
          <p className="text-sm text-gray-700 dark:text-gray-200">
            {report.status === "refunded"
              ? t("online.opponentReport.refunded")
              : t("online.opponentReport.notYet", {
                  time: formatMoment(report.readyAt, i18n.language),
                })}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * One man of a report on a phone's page of his own (C24-4, analysis §4.7), with the way back to
 * the report. A man the report does not name sends back to it.
 */
export function OnlineOpponentReportPlayer() {
  const { t } = useTranslation();
  const { reportId = "", playerId = "" } = useParams();
  const { resource, reload } = useReport(reportId);
  return (
    <ResourceState resource={resource} reload={reload}>
      {(report) => {
        const player = report.content
          ? [...report.content.eleven, ...report.content.bench].find((one) => one.id === playerId)
          : undefined;
        return (
          <div className="space-y-4">
            <Link to={reportHref(reportId)} className={`${LINK} text-sm`}>
              {t("online.opponentReport.backToReport")}
            </Link>
            {player ? (
              <>
                <h2 className="font-heading text-xl font-bold text-gray-900 dark:text-white">
                  {player.fullName}
                </h2>
                <ReportPlayerCard player={player} />
              </>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {t("online.opponentReport.playerMissing")}
              </p>
            )}
          </div>
        );
      }}
    </ResourceState>
  );
}
