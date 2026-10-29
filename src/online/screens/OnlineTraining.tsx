import { useState } from "react";
import { useTranslation } from "react-i18next";
import TrainingGroupsCard from "../../components/training/TrainingGroupsCard";
import TrainingSettingsPanel from "../../components/training/TrainingSettingsPanel";
import {
  DAY_KEYS,
  INTENSITY_COLORS,
  INTENSITY_IDS,
  SCHEDULE_COLORS,
  SCHEDULE_ICONS,
  SCHEDULE_IDS,
  SCHEDULE_TRAINING_DAYS,
  TRAINING_FOCUS_ATTRS,
  TRAINING_FOCUS_ICONS,
  TRAINING_FOCUS_IDS,
} from "../../components/training/trainingOptions";
import { resolveBackendError } from "../../utils/backendI18n";
import type { TrainingGroupData } from "../../store/types";
import type { MyClubView, TrainingPlan } from "../api";
import type { TrainingFocus, TrainingIntensity, TrainingSchedule } from "../api/domain";
import { online } from "../client";
import { inSquad, toGroupData, toPlanGroups, toTrainingRoster } from "../convert/training";
import { tracked, useOnlineStore } from "../store/onlineStore";
import TodaySession from "./training/TodaySession";
import { useActionKey } from "./useActionKey";

const pick = <T extends string>(ids: readonly string[], value: string): T | null =>
  ids.includes(value) ? (value as T) : null;

/**
 * The coach's weekly training plan (C-2 §3.4): the game's training settings panel and training
 * groups, writing the whole plan to the server on each choice, and each player's own session
 * beside it. Until the coach sets a plan, the panel shows the plan the club's AI keeps. In a
 * season that rests clubs by blocks, today's session comes first (C-8 C8-4).
 */
export default function OnlineTraining() {
  const club = useOnlineStore((state) => state.club);
  if (!club) return null;
  return <TrainingScreen club={club} />;
}

function TrainingScreen({ club }: { club: MyClubView }) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  // Kept to the squad, so a player who left the club is neither shown nor sent.
  const plan = { ...club.trainingPlan, groups: inSquad(club.trainingPlan.groups, club.players) };
  const weekday = useOnlineStore((state) => state.season?.weekday ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = useActionKey();

  const save = async (next: TrainingPlan) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await key.run(
        (idempotencyKey) => tracked(() => online.clubs.setTraining(next, idempotencyKey)),
        JSON.stringify(next),
      );
      const current = useOnlineStore.getState().club;
      if (current) {
        useOnlineStore
          .getState()
          .setClub({ ...current, trainingPlan: saved, trainingPlanIsOwn: true });
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  };

  const setTraining = (focus: string, intensity: string) => {
    const nextFocus = pick<TrainingFocus>(TRAINING_FOCUS_IDS, focus);
    const nextIntensity = pick<TrainingIntensity>(INTENSITY_IDS, intensity);
    if (nextFocus && nextIntensity) {
      void save({ ...plan, focus: nextFocus, intensity: nextIntensity });
    }
  };

  const saveGroups = (groups: TrainingGroupData[]) => {
    void save({ ...plan, groups: toPlanGroups(groups, TRAINING_FOCUS_IDS) });
  };

  const setPlayerFocus = async (playerId: string, focus: string | null) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await key.run(
        (idempotencyKey) =>
          tracked(() => online.players.setTrainingFocus(playerId, focus, idempotencyKey)),
        `${playerId}:${focus}`,
      );
      useOnlineStore.getState().setClub(updated);
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  };

  const setSchedule = (schedule: string) => {
    const next = pick<TrainingSchedule>(SCHEDULE_IDS, schedule);
    if (next) void save({ ...plan, schedule: next });
  };

  return (
    <div className="space-y-4">
      {club.trainingDay && <TodaySession club={club} trainingDay={club.trainingDay} />}
      {!club.trainingPlanIsOwn && (
        <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
          {t("online.training.noPlan")}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
      <TrainingSettingsPanel
        currentFocus={plan.focus}
        currentIntensity={plan.intensity}
        currentSchedule={plan.schedule}
        isSaving={saving || offline}
        todayWeekday={weekday}
        isTodayTraining={
          weekday !== null && (SCHEDULE_TRAINING_DAYS[plan.schedule] ?? []).includes(weekday)
        }
        activeFocusAttrs={TRAINING_FOCUS_ATTRS[plan.focus] ?? []}
        onSetTraining={setTraining}
        onSetSchedule={setSchedule}
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
        groups={toGroupData(plan.groups)}
        teamFocus={plan.focus}
        roster={toTrainingRoster(club.players)}
        isSaving={saving || offline}
        onSaveGroups={saveGroups}
        onSetPlayerFocus={(playerId, focus) => void setPlayerFocus(playerId, focus)}
        trainingFocusIds={TRAINING_FOCUS_IDS}
        trainingFocusIcons={TRAINING_FOCUS_ICONS}
      />
    </div>
  );
}
