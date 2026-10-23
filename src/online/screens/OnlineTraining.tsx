import { useState } from "react";
import { useTranslation } from "react-i18next";
import TrainingSettingsPanel from "../../components/training/TrainingSettingsPanel";
import {
  DAY_KEYS,
  INTENSITY_COLORS,
  INTENSITY_IDS,
  SCHEDULE_COLORS,
  SCHEDULE_ICONS,
  SCHEDULE_IDS,
  TRAINING_FOCUS_ATTRS,
  TRAINING_FOCUS_ICONS,
  TRAINING_FOCUS_IDS,
} from "../../components/training/trainingOptions";
import { resolveBackendError } from "../../utils/backendI18n";
import type { MyClubView, TrainingPlan } from "../api";
import type { TrainingFocus, TrainingIntensity, TrainingSchedule } from "../api/domain";
import { online } from "../client";
import { tracked, useOnlineStore } from "../store/onlineStore";
import { useActionKey } from "./useActionKey";

/**
 * The game's own defaults for a club's training (`domain::team`): what the screen starts from
 * when the coach has not set a plan yet. Until then the club trains as its AI plans it.
 */
export const DEFAULT_PLAN: TrainingPlan = {
  focus: "Physical",
  intensity: "Medium",
  schedule: "Balanced",
  groups: [],
};

const pick = <T extends string>(ids: readonly string[], value: string): T | null =>
  ids.includes(value) ? (value as T) : null;

/**
 * The coach's weekly training plan (C-2 §3.4): the game's training settings panel, writing the
 * whole plan to the server on each choice. Training groups keep what the plan has; they are not
 * edited online yet.
 */
export default function OnlineTraining() {
  const club = useOnlineStore((state) => state.club);
  if (!club) return null;
  return <TrainingScreen club={club} />;
}

function TrainingScreen({ club }: { club: MyClubView }) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const plan = club.trainingPlan ?? DEFAULT_PLAN;
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
      if (current) useOnlineStore.getState().setClub({ ...current, trainingPlan: saved });
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

  const setSchedule = (schedule: string) => {
    const next = pick<TrainingSchedule>(SCHEDULE_IDS, schedule);
    if (next) void save({ ...plan, schedule: next });
  };

  return (
    <div className="space-y-4">
      {!club.trainingPlan && (
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
        todayWeekday={null}
        isTodayTraining={false}
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
    </div>
  );
}
