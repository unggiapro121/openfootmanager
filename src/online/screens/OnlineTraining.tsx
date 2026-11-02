import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  INTENSITY_IDS,
  SCHEDULE_IDS,
  TRAINING_FOCUS_IDS,
} from "../../components/training/trainingOptions";
import { resolveBackendError } from "../../utils/backendI18n";
import type { TrainingGroupData } from "../../store/types";
import type { MyClubView, TrainingPlan } from "../api";
import type { TrainingFocus, TrainingIntensity, TrainingSchedule } from "../api/domain";
import { online } from "../client";
import {
  focusFitsOf,
  inSquad,
  toGroupData,
  toPlanGroups,
  toTrainingRoster,
} from "../convert/training";
import { tracked, useOnlineStore } from "../store/onlineStore";
import TodaySession from "./training/TodaySession";
import TrainingGroups from "./training/TrainingGroups";
import WeeklyPlan from "./training/WeeklyPlan";
import { useActionKey } from "./useActionKey";

const pick = <T extends string>(ids: readonly string[], value: string): T | null =>
  ids.includes(value) ? (value as T) : null;

/**
 * The coach's training page (design tap-luyen.html; C-2 §3.4): in a season that rests clubs by
 * blocks, today's training first (C-8 C8-4); then two tabs, the weekly plan and the training
 * groups with each player's own focus, writing the whole plan to the server on each choice. Until
 * the coach sets a plan, the tabs show the plan the club's AI keeps.
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
  const [tab, setTab] = useState<"plan" | "groups">("plan");
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
      await refreshClub();
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
    <div className="@container flex flex-col gap-6">
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
      <div className="flex flex-col gap-5">
        <div
          role="tablist"
          aria-label={t("online.training.tab.label")}
          className="flex gap-1 border-b border-gray-200 dark:border-navy-600"
        >
          <UnderlineTab selected={tab === "plan"} onClick={() => setTab("plan")}>
            {t("online.training.tab.plan")}
          </UnderlineTab>
          <UnderlineTab selected={tab === "groups"} onClick={() => setTab("groups")}>
            {t("online.training.tab.groups", { count: plan.groups.length })}
          </UnderlineTab>
        </div>
        {tab === "plan" ? (
          <WeeklyPlan
            plan={plan}
            weekday={weekday}
            disabled={saving || offline}
            onSchedule={setSchedule}
            onFocus={(focus) => setTraining(focus, plan.intensity)}
            onIntensity={(intensity) => setTraining(plan.focus, intensity)}
          />
        ) : (
          <TrainingGroups
            groups={toGroupData(plan.groups)}
            teamFocus={plan.focus}
            roster={toTrainingRoster(club.players)}
            focusFits={focusFitsOf(club.players)}
            disabled={saving || offline}
            onSaveGroups={saveGroups}
            onSetPlayerFocus={(playerId, focus) => void setPlayerFocus(playerId, focus)}
          />
        )}
      </div>
    </div>
  );
}

/** A tab of the page, underlined green while chosen (design tap-luyen.html). */
/**
 * The club read again after a saved plan, for the focus hints it changes (S-31b, C-13a). A failed
 * read keeps the club shown: its hints were read for the old plan, and the hint hides itself for
 * a focus it was not read for.
 */
async function refreshClub(): Promise<void> {
  try {
    useOnlineStore.getState().setClub(await tracked(() => online.clubs.mine()));
  } catch {
    // The plan is saved; only the hints wait for the next read of the club.
  }
}

function UnderlineTab({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`-mb-px h-11 border-b-2 px-4 font-heading text-base font-bold uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
        selected
          ? "border-primary-500 text-gray-900 dark:text-white"
          : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
