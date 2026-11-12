import { useCallback, useEffect, useState } from "react";
import type { OpponentReportView } from "../../../api";
import { online } from "../../../client";
import { tracked, useOnlineStore } from "../../../store/onlineStore";
import type { OnlineResource } from "../../../useOnlineResource";

/**
 * One report of the club, read when it opens and again on each ring of the club's reports
 * (C-24b): a report back while its page is open comes in on its own. Once read, it stays shown
 * while it is read again, so a dialog over it does not close.
 */
export function useReport(reportId: string): {
  resource: OnlineResource<OpponentReportView>;
  reload: () => void;
} {
  const rings = useOnlineStore((state) => state.opponentReportRings);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const [resource, setResource] = useState<OnlineResource<OpponentReportView>>({
    status: "loading",
  });
  useEffect(() => {
    let current = true;
    tracked(() => online.opponentReports.byId(reportId))
      .then((data) => current && setResource({ status: "ready", data }))
      .catch(
        (error: unknown) =>
          current &&
          setResource((shown) =>
            shown.status === "ready" && shown.data.id === reportId
              ? shown
              : { status: "failed", error },
          ),
      );
    return () => {
      current = false;
    };
  }, [reportId, rings, attempt]);
  // Another report's view, still held while this one is read, is not this one.
  if (resource.status === "ready" && resource.data.id !== reportId)
    return { resource: { status: "loading" }, reload };
  return { resource, reload };
}
