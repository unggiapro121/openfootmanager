import { useState } from "react";
import {
  INTENSITY_IDS,
  SCHEDULE_IDS,
  TRAINING_FOCUS_IDS,
} from "../../../components/training/trainingOptions";
import type { TrainingGroupData } from "../../../store/types";
import type { MyClubView, TrainingPlan } from "../../api";
import type { TrainingFocus, TrainingIntensity, TrainingSchedule } from "../../api/domain";
import { online } from "../../client";
import { inSquad, toPlanGroups } from "../../convert/training";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";

const pick = <T extends string>(ids: readonly string[], value: string): T | null =>
  ids.includes(value) ? (value as T) : null;

/**
 * The club read again after a saved plan, for the focus hints it changes (S-31b, C-13a). A failed
 * read keeps the club shown: its hints were read for the old plan, and the hint hides itself for
 * a focus it was not read for.
 */
async function refreshFocusHints(): Promise<void> {
  try {
    useOnlineStore.getState().setClub(await tracked(() => online.clubs.mine()));
  } catch {
    // The plan is saved; only the hints wait for the next read of the club.
  }
}

/**
 * The club's training plan and the ways to change it, each writing the whole plan to the server
 * (C-2 §3.4): the schedule, the team's focus and intensity, the groups, a player's own focus.
 * The plan is kept to the squad, so a player who left the club is neither shown nor sent.
 */
export function useTrainingPlan(club: MyClubView) {
  const plan = { ...club.trainingPlan, groups: inSquad(club.trainingPlan.groups, club.players) };
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
      await refreshFocusHints();
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

  return {
    plan,
    saving,
    error,
    setSchedule,
    setFocus: (focus: string) => setTraining(focus, plan.intensity),
    setIntensity: (intensity: string) => setTraining(plan.focus, intensity),
    saveGroups,
    setPlayerFocus,
  };
}
