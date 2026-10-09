import { Eye } from "lucide-react";
import { useTranslation } from "react-i18next";

import { translatePositionAbbreviation } from "../squad/SquadTab.helpers";
import { calcAge, positionBadgeVariant } from "../../lib/helpers";
import type { StaffData, WatchedProspect } from "../../store/types";
import { Badge, Button, Card, CardBody, CardHeader, Select } from "../ui";

/** Most prospects one scout can follow at once; the backend enforces it too. */
const MAX_WATCHED_PER_SCOUT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

interface ScoutingWatchlistCardProps {
  watchlist: WatchedProspect[];
  scouts: StaffData[];
  /** The game's current date, to count the weeks each prospect has left. */
  currentDate: string;
  busy: boolean;
  errorMessage?: string | null;
  onAssignScout: (prospectId: string, scoutId: string | null) => void;
  onSign: (prospectId: string) => void;
  onUnwatch: (prospectId: string) => void;
}

function weeksLeft(expiresOn: string, currentDate: string): number {
  const days =
    (Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(currentDate.slice(0, 10))) / DAY_MS;
  return Math.max(0, Math.ceil(days / 7));
}

/**
 * The youth watchlist: each prospect the club is following, the ranges the
 * scouts have narrowed him to, who follows him and how long he has left.
 */
export default function ScoutingWatchlistCard({
  watchlist,
  scouts,
  currentDate,
  busy,
  errorMessage,
  onAssignScout,
  onSign,
  onUnwatch,
}: ScoutingWatchlistCardProps) {
  const { t } = useTranslation();
  const load = (scoutId: string) => watchlist.filter((entry) => entry.scout_id === scoutId).length;
  const range = (low: number, high: number) => t("inbox.youthProspectRange", { low, high });

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
                  <th className="py-2 pr-3">{t("scouting.watchlistTimeLeft")}</th>
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
                          <span className="font-semibold text-gray-800 dark:text-gray-100">
                            {prospect.full_name}
                          </span>
                          <Badge variant={positionBadgeVariant(prospect.position)} size="sm">
                            {translatePositionAbbreviation(t, prospect.position)}
                          </Badge>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {t("common.age")} {calcAge(prospect.date_of_birth)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-200">
                        {range(estimate.ovr_low, estimate.ovr_high)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-200">
                        {range(estimate.potential_low, estimate.potential_high)}
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
                      <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">
                        {t("scouting.watchlistWeeksLeft", {
                          weeks: weeksLeft(entry.expires_on, currentDate),
                        })}
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
    </Card>
  );
}
