import type { GameStateData } from "../../store/gameStore";
import { Card, CardHeader, CardBody, ProgressBar, CountryFlag } from "../ui";
import { ManagerCareerChart } from "./ManagerCareerChart";
import { ManagerReputationChart } from "./ManagerReputationChart";
import { PlayStyleMasteryCard } from "./PlayStyleMasteryCard";
import { getLastReputationChange, getReputationLog } from "../../lib/managerReputation";
import { getManagerProgression } from "../../services/managerProgressionService";
import { type CoachProgressView, getCoachProgress } from "../../services/coachService";
import type { ManagerProgressionView } from "../../store/types";
import { useEffect, useState } from "react";
import { formatDate } from "../../lib/helpers";
import { useTranslation } from "react-i18next";
import { countryName } from "../../lib/countries";
import ContextMenu from "../ContextMenu";
import { buildViewTeamMenuItem } from "../playerActions/playerContextMenuItems";

interface ManagerTabProps {
  gameState: GameStateData;
  onSelectTeam?: (id: string) => void;
}

export default function ManagerTab({ gameState, onSelectTeam }: ManagerTabProps) {
  const { t, i18n } = useTranslation();
  const mgr = gameState.manager;
  const myTeam = gameState.teams.find((tm) => tm.id === mgr.team_id);
  const stats = mgr.career_stats;
  const reputationLog = getReputationLog(mgr);
  const [progression, setProgression] = useState<ManagerProgressionView | null>(null);
  // The coach account's progress; null for a career without one (an agent's game).
  const [coachProgress, setCoachProgress] = useState<CoachProgressView | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCoachProgress()
      .then((view) => {
        if (!cancelled) setCoachProgress(view);
      })
      .catch(() => {
        if (!cancelled) setCoachProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [stats]);

  useEffect(() => {
    let cancelled = false;
    getManagerProgression()
      .then((view) => {
        if (!cancelled) setProgression(view);
      })
      .catch((err) => console.error("Failed to load the manager's progression:", err));
    return () => {
      cancelled = true;
    };
  }, [mgr.play_style_mastery, mgr.progression]);
  const lastReputationChange = getLastReputationChange(mgr);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {/* Profile card */}
      <Card accent="primary" className="md:col-span-3">
        <div className="bg-gradient-to-r from-navy-700 to-navy-800 p-6 rounded-t-xl flex items-center gap-6">
          <div className="w-20 h-20 rounded-xl bg-primary-500/20 flex items-center justify-center font-heading font-bold text-3xl text-primary-400 border-2 border-primary-500/30">
            {mgr.first_name.charAt(0)}
            {mgr.last_name.charAt(0)}
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold text-white uppercase tracking-wide">
              {mgr.first_name} {mgr.last_name}
            </h2>
            <p className="text-gray-400 text-sm mt-1">
              <CountryFlag
                code={mgr.nationality}
                locale={i18n.language}
                className="mr-1 text-sm leading-none"
              />
              {countryName(mgr.nationality, i18n.language)} • {t("manager.born")}{" "}
              {formatDate(mgr.date_of_birth, i18n.language)}
            </p>
            {myTeam && onSelectTeam ? (
              <ContextMenu items={[buildViewTeamMenuItem(t, () => onSelectTeam(myTeam.id))]}>
                <button
                  type="button"
                  data-testid="manager-current-team"
                  onClick={() => onSelectTeam(myTeam.id)}
                  className="text-primary-400 text-sm font-semibold mt-0.5 hover:text-primary-300 transition-colors"
                >
                  {t("manager.managerOf", { team: myTeam.name })}
                </button>
              </ContextMenu>
            ) : myTeam ? (
              <p className="text-primary-400 text-sm font-semibold mt-0.5">
                {t("manager.managerOf", { team: myTeam.name })}
              </p>
            ) : null}
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-gray-400 font-heading uppercase tracking-wider">
              {t("manager.reputation")}
            </p>
            <p className="font-heading font-bold text-2xl text-accent-400">{mgr.reputation}</p>
            {lastReputationChange && (
              <p
                data-testid="manager-reputation-change"
                className={`text-xs font-semibold mt-0.5 ${
                  lastReputationChange.delta >= 0
                    ? "text-green-400 dark:text-green-400"
                    : "text-red-400 dark:text-red-400"
                }`}
              >
                {t("manager.reputationChange", {
                  delta:
                    lastReputationChange.delta > 0
                      ? `+${lastReputationChange.delta}`
                      : `${lastReputationChange.delta}`,
                  season: lastReputationChange.season,
                })}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Career stats */}
      <Card accent="accent" className="md:col-span-2">
        <CardHeader>{t("manager.careerStats")}</CardHeader>
        <CardBody>
          {coachProgress ? (
            <div className="flex flex-col gap-4">
              <CareerStatsRow
                label={t("coach.allCareers")}
                totals={coachProgress.progress.totals}
              />
              <CareerStatsRow
                label={t("coach.thisCareer")}
                totals={{ ...stats, matches: stats.matches_managed }}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("coach.dailyXp", {
                  count: coachProgress.counted_today,
                  limit: coachProgress.daily_limit,
                  time: new Date(coachProgress.next_reset_unix * 1000).toLocaleTimeString(
                    i18n.language,
                    { hour: "2-digit", minute: "2-digit" },
                  ),
                })}
              </p>
            </div>
          ) : (
            <CareerStatsRow totals={{ ...stats, matches: stats.matches_managed }} />
          )}
        </CardBody>
      </Card>

      {/* Board satisfaction + Fan approval */}
      <Card>
        <CardHeader>{t("manager.boardStatus")}</CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-4">
            {/* Board */}
            <div>
              <div className="text-center mb-2">
                <p className="font-heading font-bold text-3xl text-gray-800 dark:text-gray-100">
                  {mgr.satisfaction}%
                </p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-heading uppercase tracking-wider mt-0.5">
                  {t("manager.board")}
                </p>
              </div>
              <ProgressBar value={mgr.satisfaction} variant="auto" size="md" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center mt-2">
                {mgr.satisfaction >= 80
                  ? t("manager.boardVeryPleased")
                  : mgr.satisfaction >= 50
                    ? t("manager.boardSatisfied")
                    : mgr.satisfaction >= 30
                      ? t("manager.boardConcerns")
                      : t("manager.boardThreat")}
              </p>
            </div>
            {/* Fans */}
            <div>
              <div className="text-center mb-2">
                <p className="font-heading font-bold text-3xl text-gray-800 dark:text-gray-100">
                  {mgr.fan_approval ?? 50}%
                </p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-heading uppercase tracking-wider mt-0.5">
                  {t("manager.fans")}
                </p>
              </div>
              <ProgressBar value={mgr.fan_approval ?? 50} variant="auto" size="md" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center mt-2">
                {(mgr.fan_approval ?? 50) >= 80
                  ? t("manager.fanAdore")
                  : (mgr.fan_approval ?? 50) >= 60
                    ? t("manager.fanBehind")
                    : (mgr.fan_approval ?? 50) >= 40
                      ? t("manager.fanMixed")
                      : (mgr.fan_approval ?? 50) >= 20
                        ? t("manager.fanRestless")
                        : t("manager.fanUnrest")}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Play style mastery */}
      <PlayStyleMasteryCard manager={mgr} progression={progression} />

      {/* Reputation perks: what the user's standing is worth off the pitch */}
      {progression?.perks &&
        (progression.perks.wage_discount_pct > 0 || progression.perks.sponsor_uplift_pct > 0) && (
          <Card className="md:col-span-3">
            <section aria-label={t("manager.reputationPerks")}>
              <CardHeader>{t("manager.reputationPerks")}</CardHeader>
              <CardBody>
                <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
                  <li>
                    {t("manager.perkWageDiscount", { pct: progression.perks.wage_discount_pct })}
                  </li>
                  <li>
                    {t("manager.perkSponsorUplift", { pct: progression.perks.sponsor_uplift_pct })}
                  </li>
                </ul>
              </CardBody>
            </section>
          </Card>
        )}

      {/* Reputation history */}
      {reputationLog.length > 0 && (
        <Card className="md:col-span-3">
          <section aria-label={t("manager.reputationHistory")}>
            <CardHeader>{t("manager.reputationHistory")}</CardHeader>
            <CardBody>
              <ManagerReputationChart
                log={reputationLog}
                reputationLabel={t("manager.reputation")}
              />
            </CardBody>
          </section>
        </Card>
      )}

      {/* Career history */}
      {mgr.career_history.length > 0 && (
        <Card className="md:col-span-3">
          <CardHeader>{t("manager.careerHistory")}</CardHeader>
          <CardBody className="p-0">
            <div className="px-4 pt-4 pb-2">
              <ManagerCareerChart
                history={mgr.career_history}
                wonLabel={t("manager.wins")}
                drawnLabel={t("manager.draws")}
                lostLabel={t("manager.losses")}
              />
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-navy-800 border-b border-gray-200 dark:border-navy-600 text-xs">
                  <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t("manager.club")}
                  </th>
                  <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t("manager.period")}
                  </th>
                  <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center">
                    {t("common.played")}
                  </th>
                  <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center">
                    {t("common.won")}
                  </th>
                  <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center">
                    {t("common.drawn")}
                  </th>
                  <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center">
                    {t("common.lost")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
                {mgr.career_history.map((entry, i) => {
                  const canSelectTeam =
                    !!onSelectTeam && gameState.teams.some((team) => team.id === entry.team_id);
                  const historyRow = (
                    <tr
                      key={i}
                      data-testid={`manager-history-${entry.team_id}`}
                      onClick={canSelectTeam ? () => onSelectTeam(entry.team_id) : undefined}
                      onKeyDown={
                        canSelectTeam
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onSelectTeam(entry.team_id);
                              }
                            }
                          : undefined
                      }
                      role={canSelectTeam ? "button" : undefined}
                      tabIndex={canSelectTeam ? 0 : undefined}
                      className={
                        canSelectTeam
                          ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-navy-700/30 transition-colors"
                          : undefined
                      }
                    >
                      <td className="py-3 px-5 font-semibold text-sm text-gray-800 dark:text-gray-200">
                        {entry.team_name}
                      </td>
                      <td className="py-3 px-5 text-sm text-gray-500 dark:text-gray-400">
                        {entry.start_date.substring(0, 4)} —{" "}
                        {entry.end_date?.substring(0, 4) || t("common.present")}
                      </td>
                      <td className="py-3 px-5 text-center text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                        {entry.matches}
                      </td>
                      <td className="py-3 px-5 text-center text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                        {entry.wins}
                      </td>
                      <td className="py-3 px-5 text-center text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                        {entry.draws}
                      </td>
                      <td className="py-3 px-5 text-center text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                        {entry.losses}
                      </td>
                    </tr>
                  );

                  if (!canSelectTeam) {
                    return historyRow;
                  }

                  return (
                    <ContextMenu
                      items={[buildViewTeamMenuItem(t, () => onSelectTeam(entry.team_id))]}
                      key={i}
                    >
                      {historyRow}
                    </ContextMenu>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

interface CareerTotals {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  trophies: number;
}

/** One line of career numbers, labelled when the screen shows more than one. */
function CareerStatsRow({ label, totals }: { label?: string; totals: CareerTotals }) {
  const { t } = useTranslation();
  const blocks = (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
      <StatBlock label={t("manager.matches")} value={totals.matches} />
      <StatBlock label={t("manager.wins")} value={totals.wins} />
      <StatBlock label={t("manager.draws")} value={totals.draws} />
      <StatBlock label={t("manager.losses")} value={totals.losses} />
      <StatBlock label={t("manager.trophies")} value={totals.trophies} />
      <StatBlock
        label={t("manager.winPercent")}
        value={totals.matches > 0 ? `${((totals.wins / totals.matches) * 100).toFixed(0)}%` : "—"}
      />
    </div>
  );
  if (!label) return blocks;
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-2 p-0 text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </legend>
      {blocks}
    </fieldset>
  );
}

function StatBlock({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="text-center p-3 bg-gray-50 dark:bg-navy-700 rounded-lg">
      <p className="font-heading font-bold text-xl text-gray-800 dark:text-gray-100 tabular-nums">
        {value}
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500 font-heading uppercase tracking-wider mt-0.5">
        {label}
      </p>
    </div>
  );
}
