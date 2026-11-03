import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePhoneLayout } from "../../hooks/usePhoneLayout";
import { resolveBackendError } from "../../utils/backendI18n";
import type { MyClubView } from "../api";
import { focusFitsOf, toGroupData, toTrainingRoster } from "../convert/training";
import { useOnlineStore } from "../store/onlineStore";
import PhoneTraining from "./training/phone/PhoneTraining";
import TodaySession from "./training/TodaySession";
import TrainingGroups from "./training/TrainingGroups";
import { useTrainingPlan } from "./training/useTrainingPlan";
import WeeklyPlan from "./training/WeeklyPlan";

/**
 * The coach's training page (design tap-luyen.html; C-2 §3.4): in a season that rests clubs by
 * blocks, today's training first (C-8 C8-4); then two tabs, the weekly plan and the training
 * groups with each player's own focus, writing the whole plan to the server on each choice. Until
 * the coach sets a plan, the tabs show the plan the club's AI keeps.
 */
export default function OnlineTraining() {
  const club = useOnlineStore((state) => state.club);
  const phone = usePhoneLayout();
  if (!club) return null;
  return phone ? <PhoneTraining club={club} /> : <TrainingScreen club={club} />;
}

function TrainingScreen({ club }: { club: MyClubView }) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const weekday = useOnlineStore((state) => state.season?.weekday ?? null);
  const [tab, setTab] = useState<"plan" | "groups">("plan");
  const { plan, saving, error, setSchedule, setFocus, setIntensity, saveGroups, setPlayerFocus } =
    useTrainingPlan(club);

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
            onFocus={setFocus}
            onIntensity={setIntensity}
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
