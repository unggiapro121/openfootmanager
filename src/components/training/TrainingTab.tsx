import { useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { GameStateData } from "../../store/gameStore";
import { useGameStore } from "../../store/gameStore";
import { isSeniorSquadPlayer } from "../../lib/playerSquad";
import { useFetchedSquad } from "../../hooks/useFetchedSquad";
import { setTraining, setTrainingSchedule } from "../../services/trainingService";
import { Card, CardBody, CardHeader, ProgressBar } from "../ui";
import TrainingGroupsCard from "./TrainingGroupsCard";
import TrainingSettingsPanel from "./TrainingSettingsPanel";
import { getTrainingStaffAdvice } from "./trainingAdvice";

interface TrainingTabProps {
  gameState: GameStateData | null;
  onGameUpdate?: (state: GameStateData) => void;
}

import {
  DAY_KEYS,
  getWeekdayFromDate,
  INTENSITY_COLORS,
  INTENSITY_IDS,
  SCHEDULE_COLORS,
  SCHEDULE_ICONS,
  SCHEDULE_IDS,
  SCHEDULE_TRAINING_DAYS,
  TRAINING_FOCUS_ATTRS,
  TRAINING_FOCUS_ICONS,
  TRAINING_FOCUS_IDS,
} from "./trainingOptions";

export default function TrainingTab({ gameState, onGameUpdate }: TrainingTabProps) {
  const { t } = useTranslation();
  const { sessionState } = useGameStore();
  const [isSaving, setIsSaving] = useState(false);
  const teamId = sessionState?.manager?.team_id ?? gameState?.manager?.team_id ?? null;
  const clockDate = sessionState?.clock.current_date ?? gameState?.clock.current_date ?? "";
  const [fetchedSquad, setFetchedSquad] = useFetchedSquad(teamId, clockDate);

  const team = sessionState?.team ?? gameState?.teams.find((t) => t.id === teamId) ?? null;

  if (!team) {
    return <p className="text-gray-500 dark:text-gray-400">{t("common.noTeam")}</p>;
  }

  const currentFocus = team.training_focus || "Physical";
  const currentIntensity = team.training_intensity || "Medium";
  const currentSchedule = team.training_schedule || "Balanced";

  const allSquadPlayers =
    fetchedSquad ?? gameState?.players.filter((p) => p.team_id === teamId) ?? [];
  const roster = allSquadPlayers.filter(isSeniorSquadPlayer);
  const avgCondition =
    roster.length > 0
      ? Math.round(roster.reduce((sum, player) => sum + player.condition, 0) / roster.length)
      : 0;
  const avgMorale =
    roster.length > 0
      ? Math.round(roster.reduce((sum, player) => sum + player.morale, 0) / roster.length)
      : 0;
  const exhaustedCount = roster.filter((player) => player.condition < 40).length;
  const criticalCount = roster.filter((player) => player.condition < 25).length;

  const todayWeekday = getWeekdayFromDate(clockDate);
  const trainingDays = SCHEDULE_TRAINING_DAYS[currentSchedule] || SCHEDULE_TRAINING_DAYS.Balanced;
  const isTodayTraining = trainingDays.includes(todayWeekday);

  const handleSetTraining = async (focus: string, intensity: string) => {
    setIsSaving(true);
    try {
      const updated = await setTraining(focus, intensity);
      onGameUpdate?.(updated);
    } catch (error) {
      console.error("Failed to set training:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetSchedule = async (schedule: string) => {
    setIsSaving(true);
    try {
      const updated = await setTrainingSchedule(schedule);
      onGameUpdate?.(updated);
    } catch (error) {
      console.error("Failed to set schedule:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const activeFocusAttrs = TRAINING_FOCUS_ATTRS[currentFocus] || [];
  const staffAdvice = getTrainingStaffAdvice(t, {
    criticalCount,
    avgCondition,
    exhaustedCount,
    currentSchedule,
    currentFocus,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 flex flex-col gap-5">
        {staffAdvice ? (
          <div
            className={`flex items-start gap-3 p-4 rounded-xl border-2 ${
              staffAdvice.level === "critical"
                ? "bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/40"
                : staffAdvice.level === "warn"
                  ? "bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/40"
                  : "bg-blue-50 dark:bg-blue-500/10 border-blue-300 dark:border-blue-500/40"
            }`}
          >
            {staffAdvice.level === "critical" ? (
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            ) : staffAdvice.level === "warn" ? (
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            ) : (
              <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <p
                className={`text-xs font-heading font-bold uppercase tracking-wider mb-0.5 ${
                  staffAdvice.level === "critical"
                    ? "text-red-600 dark:text-red-400"
                    : staffAdvice.level === "warn"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-blue-600 dark:text-blue-400"
                }`}
              >
                {staffAdvice.level === "critical"
                  ? t("training.staffAlert")
                  : staffAdvice.level === "warn"
                    ? t("training.staffWarning")
                    : t("training.staffSuggestion")}
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300">{staffAdvice.message}</p>
            </div>
          </div>
        ) : null}

        <TrainingSettingsPanel
          currentFocus={currentFocus}
          currentIntensity={currentIntensity}
          currentSchedule={currentSchedule}
          isSaving={isSaving}
          todayWeekday={todayWeekday}
          isTodayTraining={isTodayTraining}
          activeFocusAttrs={activeFocusAttrs}
          onSetTraining={handleSetTraining}
          onSetSchedule={handleSetSchedule}
          scheduleIds={SCHEDULE_IDS}
          scheduleIcons={SCHEDULE_ICONS}
          scheduleColors={SCHEDULE_COLORS}
          dayKeys={DAY_KEYS}
          trainingFocusIds={TRAINING_FOCUS_IDS}
          trainingFocusIcons={TRAINING_FOCUS_ICONS}
          trainingFocusAttrs={TRAINING_FOCUS_ATTRS}
          intensityIds={INTENSITY_IDS}
          intensityColors={INTENSITY_COLORS}
        />

        <TrainingGroupsCard
          team={team}
          onGameUpdate={(game) => {
            onGameUpdate?.(game);
            // Patch the useFetchedSquad cache so per-player mutations
            // (individual training_focus) reflect in the roster without a
            // clock-advance or remount. Same pattern the youth-promote fix
            // uses (PR #308).
            if (teamId) {
              setFetchedSquad(game.players.filter((p) => p.team_id === teamId));
            }
          }}
          roster={roster}
          isSaving={isSaving}
          setIsSaving={setIsSaving}
          trainingFocusIds={TRAINING_FOCUS_IDS}
          trainingFocusIcons={TRAINING_FOCUS_ICONS}
        />
      </div>

      <div className="flex flex-col gap-5">
        <Card accent="accent">
          <CardHeader>{t("training.squadFitness")}</CardHeader>
          <CardBody>
            <div className="flex flex-col gap-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600 dark:text-gray-400">
                    {t("training.avgCondition")}
                  </span>
                  <span className="font-heading font-bold text-gray-800 dark:text-gray-100">
                    {avgCondition}%
                  </span>
                </div>
                <ProgressBar value={avgCondition} variant="auto" size="md" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600 dark:text-gray-400">
                    {t("training.avgMorale")}
                  </span>
                  <span className="font-heading font-bold text-gray-800 dark:text-gray-100">
                    {avgMorale}%
                  </span>
                </div>
                <ProgressBar value={avgMorale} variant="auto" size="md" />
              </div>
              {exhaustedCount > 0 || criticalCount > 0 ? (
                <div className="mt-1 pt-2 border-t border-gray-100 dark:border-navy-700">
                  {criticalCount > 0 ? (
                    <p className="text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />{" "}
                      {t("training.criticalCondition", { count: criticalCount })}
                    </p>
                  ) : null}
                  {exhaustedCount > 0 ? (
                    <p className="text-xs text-amber-500 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                      <AlertTriangle className="w-3 h-3" />{" "}
                      {t("training.exhaustedPlayers", { count: exhaustedCount })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>{t("training.playerFitness")}</CardHeader>
          <CardBody className="p-0 max-h-64 overflow-y-auto">
            <div className="divide-y divide-gray-100 dark:divide-navy-600">
              {[...roster]
                .sort((left, right) => left.condition - right.condition)
                .map((player) => (
                  <div key={player.id} className="flex items-center px-4 py-2 gap-3">
                    <span
                      className={`text-sm font-medium flex-1 truncate ${
                        player.condition < 25
                          ? "text-red-600 dark:text-red-400"
                          : player.condition < 40
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      {player.match_name}
                      {player.jersey_number != null ? ` (#${player.jersey_number})` : ""}
                    </span>
                    <ProgressBar
                      value={player.condition}
                      variant="auto"
                      size="sm"
                      showLabel
                      className="w-24"
                    />
                  </div>
                ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
