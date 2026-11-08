import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveBackendError } from "../../../../utils/backendI18n";
import type { MyClubView } from "../../../api";
import { focusFitsOf, toGroupData, toTrainingRoster } from "../../../convert/training";
import { useOnlineStore } from "../../../store/onlineStore";
import { PhoneHeaderPart } from "../../mobile/PhoneHeaderSlots";
import { FOCUS } from "../../mobile/PhoneSheet";
import { isScheduleDay } from "../trainingView";
import { useTrainingPlan } from "../useTrainingPlan";
import { PlanFocus, PlanIntensity, PlanSchedule, PlanSummary } from "../WeeklyPlan";
import { PhoneGroups } from "./PhoneGroups";
import { KEY, PlanTiles, PhoneToday } from "./PhoneToday";

type Tab = "today" | "sched" | "focus" | "groups";
const TABS: Tab[] = ["today", "sched", "focus", "groups"];

const HEADING =
  "font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white";

/** A section of a plan tab: its title and hint, then its choices. */
function PlanSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={HEADING}>{title}</h2>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">{hint}</span>
      </div>
      {children}
    </section>
  );
}

function Summary({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-white px-3.5 py-3 text-[13px] leading-snug text-gray-700 dark:bg-navy-800 dark:text-gray-300">
      {children}
    </p>
  );
}

/**
 * The training page on a phone (design m-tap-luyen): four tabs in the app bar, today (how it
 * stands, the plan's tiles, extra sessions), the weekly schedule with its intensity, the team's
 * focus, and the groups. Every choice writes the plan as the desktop page does.
 */
export default function PhoneTraining({ club }: { club: MyClubView }) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const weekday = useOnlineStore((state) => state.season?.weekday ?? null);
  const [tab, setTab] = useState<Tab>("today");
  const training = useTrainingPlan(club);
  const { plan } = training;
  const disabled = training.saving || offline;
  const label = (id: Tab) =>
    id === "groups" ? t(`${KEY}.tab.groups`, { count: plan.groups.length }) : t(`${KEY}.tab.${id}`);

  return (
    <div className="-mx-3 -mt-3 flex flex-col">
      <PhoneHeaderPart place="below">
        <div
          role="tablist"
          aria-label={t("online.training.tab.label")}
          className="grid grid-cols-4 border-t border-gray-200 px-2 dark:border-navy-700"
        >
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px h-11 whitespace-nowrap border-b-2 font-heading text-sm font-bold uppercase tracking-wide ${tab === id ? "border-primary-500 text-gray-900 dark:text-white" : "border-transparent text-gray-500 dark:text-gray-400"} ${FOCUS}`}
            >
              {label(id)}
            </button>
          ))}
        </div>
      </PhoneHeaderPart>

      <main className="flex flex-col gap-3 px-4 pb-6 pt-3">
        {!club.trainingPlanIsOwn && (
          <p role="status" className="text-xs text-gray-600 dark:text-gray-300">
            {t(
              club.trainingPlan.autoFocus ? "online.training.noPlanAuto" : "online.training.noPlan",
            )}
          </p>
        )}
        {training.error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {resolveBackendError(training.error)}
          </p>
        )}
        {tab === "today" &&
          (club.trainingDay ? (
            <PhoneToday club={club} trainingDay={club.trainingDay} onGo={setTab} />
          ) : (
            <PlanTiles
              plan={plan}
              scheduleDay={isScheduleDay(plan.schedule, weekday)}
              keeperDrill={false}
              onGo={setTab}
            />
          ))}
        {tab === "sched" && (
          <>
            <PlanSection
              title={t("training.weeklySchedule")}
              hint={t("online.training.plan.scheduleHint")}
            >
              <PlanSchedule
                plan={plan}
                weekday={weekday}
                disabled={disabled}
                onSchedule={training.setSchedule}
              />
            </PlanSection>
            <PlanSection
              title={t("training.intensity")}
              hint={t("online.training.plan.intensityHint")}
            >
              <PlanIntensity plan={plan} disabled={disabled} onIntensity={training.setIntensity} />
            </PlanSection>
            <Summary>
              <PlanSummary plan={plan} />
            </Summary>
          </>
        )}
        {tab === "focus" && (
          <>
            <PlanSection
              title={t("training.effectiveFocus")}
              hint={t("online.training.plan.focusHint")}
            >
              <PlanFocus
                plan={plan}
                autoOpen={club.autoFocusOpen}
                disabled={disabled}
                onFocus={training.setFocus}
              />
            </PlanSection>
            <Summary>
              <PlanSummary plan={plan} />
            </Summary>
          </>
        )}
        {tab === "groups" && (
          <PhoneGroups
            groups={toGroupData(plan.groups)}
            teamFocus={plan.focus}
            teamAuto={plan.autoFocus}
            roster={toTrainingRoster(club.players)}
            focusFits={focusFitsOf(club.players)}
            keeperDrill={club.trainingDay?.keeperDrill}
            disabled={disabled}
            onSaveGroups={training.saveGroups}
            onSetPlayerFocus={(playerId, focus) => void training.setPlayerFocus(playerId, focus)}
          />
        )}
      </main>
    </div>
  );
}
