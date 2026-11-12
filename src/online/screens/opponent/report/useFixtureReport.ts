import type { OpponentReportSummary } from "../../../api";
import { online } from "../../../client";
import { tracked, useOnlineStore } from "../../../store/onlineStore";
import { useOnlineResource } from "../../../useOnlineResource";

/**
 * The club's report on one fixture, if it bought one (C-24b): read again on each ring of the
 * club's reports. A server without reports, or one that cannot answer now, is simply none: the
 * line that shows it is an extra.
 */
export function useFixtureReport(fixtureId: string | undefined): OpponentReportSummary | undefined {
  const rings = useOnlineStore((state) => state.opponentReportRings);
  const { resource } = useOnlineResource(
    () =>
      fixtureId
        ? tracked(() => online.opponentReports.list({ fixtureId })).catch(() => ({ reports: [] }))
        : Promise.resolve({ reports: [] }),
    [fixtureId, rings],
  );
  return resource.status === "ready" ? resource.data.reports[0] : undefined;
}
