import { Eye } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { translatePositionAbbreviation } from "../squad/SquadTab.helpers";
import { calcAge, positionBadgeVariant } from "../../lib/helpers";
import type { StaffData, WatchedProspect } from "../../store/types";
import { Badge, Button, Card, CardBody, CardHeader, Select } from "../ui";
import WatchedProspectDetail from "./WatchedProspectDetail";

/** Most prospects one scout can follow at once; the backend enforces it too. */
const MAX_WATCHED_PER_SCOUT = 3;

interface ScoutingWatchlistCardProps {
  watchlist: WatchedProspect[];
  scouts: StaffData[];
  busy: boolean;
  errorMessage?: string | null;
  onAssignScout: (prospectId: string, scoutId: string | null) => void;
  onSign: (prospectId: string) => void;
  onUnwatch: (prospectId: string) => void;
}

/**
 * The youth watchlist: each prospect the club is following, as his scouts read
 * him now, and who follows him. Opening one shows his latest player card. He
 * stays until he signs somewhere, the manager lets him go, or the season's
 * youth pool closes.
 */
export default function ScoutingWatchlistCard({
  watchlist,
  scouts,
  busy,
  errorMessage,
  onAssignScout,
  onSign,
  onUnwatch,
}: ScoutingWatchlistCardProps) {
  const { t } = useTranslation();
  const load = (scoutId: string) => watchlist.filter((entry) => entry.scout_id === scoutId).length;
  const range = (low: number, high: number) => t("inbox.youthProspectRange", { low, high });
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = watchlist.find((entry) => entry.prospect.id === openId);
  const openedScout = scouts.find((scout) => scout.id === opened?.scout_id);

  return (
    <Card>
      <CardHeader>{t("scouting.watchlistTitle")}</CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("scouting.watchlistHint")}</p>
        {errorMessage ? (
          <span role="alert" className="text-xs text-red-600 dark:text-red-400">
            {errorMessage}
          </span>
        ) : null}
        {watchlist.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-gray-200 dark:border-navy-600 bg-gray-50 dark:bg-navy-800/40 px-4 py-4">
            <Eye className="w-5 h-5 text-primary-500 shrink-0" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("scouting.watchlistEmpty")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="text-xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-navy-600">
                  <th className="py-2 pr-3">{t("common.player")}</th>
                  <th className="py-2 pr-3">{t("youthAcademy.ovr")}</th>
                  <th className="py-2 pr-3">{t("youthAcademy.potential")}</th>
                  <th className="py-2 pr-3">{t("scouting.watchlistScout")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
                {watchlist.map((entry) => {
                  const { prospect, estimate } = entry;
                  const choices = scouts.filter(
                    (scout) =>
                      scout.id === entry.scout_id || load(scout.id) < MAX_WATCHED_PER_SCOUT,
                  );
                  return (
                    <tr key={prospect.id}>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setOpenId(prospect.id)}
                            className="font-semibold text-gray-800 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
                          >
                            {prospect.full_name}
                          </button>
                          <Badge variant={positionBadgeVariant(prospect.position)} size="sm">
                            {translatePositionAbbreviation(t, prospect.position)}
                          </Badge>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {t("common.age")} {calcAge(prospect.date_of_birth)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-200">
                        {entry.report?.avg_rating != null
                          ? `~${entry.report.avg_rating}`
                          : range(estimate.ovr_low, estimate.ovr_high)}
                      </td>
                      <td className="py-2 pr-3 text-gray-700 dark:text-gray-200">
                        {entry.report
                          ? t(entry.report.potential_key)
                          : range(estimate.potential_low, estimate.potential_high)}
                      </td>
                      <td className="py-2 pr-3 min-w-[10rem]">
                        <Select
                          selectSize="xs"
                          value={entry.scout_id ?? ""}
                          disabled={busy}
                          aria-label={t("scouting.watchlistScoutFor", { name: prospect.full_name })}
                          onChange={(event) =>
                            onAssignScout(prospect.id, event.target.value || null)
                          }
                        >
                          <option value="">{t("scouting.watchlistNoScout")}</option>
                          {choices.map((scout) => (
                            <option key={scout.id} value={scout.id}>
                              {t("scouting.watchlistScoutLoad", {
                                name: scout.first_name,
                                count: load(scout.id),
                              })}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-2">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" disabled={busy} onClick={() => onSign(prospect.id)}>
                            {t("scouting.watchlistSign")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => onUnwatch(prospect.id)}
                          >
                            {t("scouting.watchlistUnwatch")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
      {opened?.report ? (
        <WatchedProspectDetail
          entry={opened}
          report={opened.report}
          scoutName={openedScout ? `${openedScout.first_name} ${openedScout.last_name}` : null}
          busy={busy}
          onSign={() => onSign(opened.prospect.id)}
          onUnwatch={() => {
            onUnwatch(opened.prospect.id);
            setOpenId(null);
          }}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </Card>
  );
}
