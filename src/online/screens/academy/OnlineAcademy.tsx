import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { refreshAcademy, refreshItems, useOnlineStore } from "../../store/onlineStore";
import ResourceState from "../ResourceState";
import AcademyFigures from "./AcademyFigures";
import { GraduatesSection, YoungstersSection } from "./AcademyPlayers";
import ScoutPanel from "./ScoutPanel";

/**
 * The club's youth academy (C-7c, C7-38, design HocVien.dc.html): its figures, its youngsters
 * beside the scout panel, and who graduated. Every number is the server's: slots, ranges, when a
 * youngster graduates. A season without academy rules shows a banner and what the academy still
 * holds.
 */
export default function OnlineAcademy() {
  const { t } = useTranslation();
  const academy = useOnlineStore((state) => state.academy);
  const unseen = useOnlineStore((state) => state.academyUnseen);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    refreshAcademy().catch(setLoadError);
    // The hourglass and the tickets are counted from the inventory.
    if (useOnlineStore.getState().items === undefined) void refreshItems().catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  // The page is open: a report back is seen here, so the sidebar's dot goes out.
  useEffect(() => {
    if (unseen) useOnlineStore.setState({ academyUnseen: false });
  }, [unseen]);

  if (academy === undefined) {
    return (
      <ResourceState
        resource={loadError ? { status: "failed", error: loadError } : { status: "loading" }}
        reload={load}
      >
        {() => null}
      </ResourceState>
    );
  }
  if (academy === null) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.academy.notOnServer")}</p>
    );
  }
  const youngsters = academy.enabled || academy.players.length > 0;
  return (
    <div className="flex flex-col gap-6">
      {!academy.enabled && (
        <p
          role="note"
          className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-200"
        >
          {t("online.academy.disabled")}
        </p>
      )}
      <AcademyFigures academy={academy} />
      {youngsters && (
        <div className="flex flex-wrap items-start gap-6">
          <YoungstersSection academy={academy} />
          {academy.enabled && <ScoutPanel academy={academy} />}
        </div>
      )}
      <GraduatesSection academy={academy} />
    </div>
  );
}
