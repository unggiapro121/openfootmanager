import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  DAY_KEYS,
  INTENSITY_IDS,
  SCHEDULE_ICONS,
  SCHEDULE_IDS,
  TRAINING_FOCUS_ATTRS,
  TRAINING_FOCUS_ICONS,
  TRAINING_FOCUS_IDS,
} from "../../../components/training/trainingOptions";
import type { TrainingPlan } from "../../api";
import { scheduleWeek } from "./trainingView";

/** An option card of the plan: a radio, outlined green when chosen. */
function optionClass(selected: boolean): string {
  return `rounded-xl border text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-navy-800 ${
    selected
      ? "border-primary-500 bg-primary-50 dark:bg-primary-900/30"
      : "border-gray-200 bg-gray-50 hover:border-primary-400 dark:border-navy-600 dark:bg-navy-800 dark:hover:border-primary-500"
  }`;
}

export const SCHEDULE_TONES: Record<string, string> = {
  Intense: "text-red-600 dark:text-red-400",
  Balanced: "text-primary-600 dark:text-primary-300",
  Light: "text-blue-600 dark:text-blue-300",
};

const INTENSITY_TONES: Record<string, string> = {
  Low: "text-blue-600 dark:text-blue-300",
  Medium: "text-accent-700 dark:text-accent-300",
  High: "text-red-600 dark:text-red-400",
};

/** One row of the plan: its name and hint on the left, its choices on the right. */
function PlanRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 border-b border-gray-200 px-6 py-5 @3xl:grid-cols-[170px_minmax(0,1fr)] @3xl:gap-6 dark:border-navy-600">
      <div className="flex flex-col gap-1">
        <h3 className="font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white">
          {title}
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">{hint}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * The weekly plan tab (design tap-luyen.html): the schedule with its week, the team's focus with
 * the attributes it trains, the intensity of the schedule's days, and what that adds up to. Each
 * choice is saved at once by the page.
 */
export default function WeeklyPlan({
  plan,
  weekday,
  disabled,
  onSchedule,
  onFocus,
  onIntensity,
}: {
  plan: TrainingPlan;
  /** Today's weekday, 0 = Monday; null while the season does not say it. */
  weekday: number | null;
  disabled: boolean;
  onSchedule: (schedule: string) => void;
  onFocus: (focus: string) => void;
  onIntensity: (intensity: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("online.training.tab.plan")}
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-navy-600 dark:bg-navy-700"
    >
      <PlanRow title={t("training.weeklySchedule")} hint={t("online.training.plan.scheduleHint")}>
        <PlanSchedule plan={plan} weekday={weekday} disabled={disabled} onSchedule={onSchedule} />
      </PlanRow>
      <PlanRow title={t("training.effectiveFocus")} hint={t("online.training.plan.focusHint")}>
        <PlanFocus plan={plan} disabled={disabled} onFocus={onFocus} />
      </PlanRow>
      <PlanRow title={t("training.intensity")} hint={t("online.training.plan.intensityHint")}>
        <PlanIntensity plan={plan} disabled={disabled} onIntensity={onIntensity} />
      </PlanRow>
      <p className="bg-gray-50 px-6 py-3.5 text-sm text-gray-700 dark:bg-navy-900 dark:text-gray-300">
        <PlanSummary plan={plan} />
      </p>
    </section>
  );
}

/** The schedules to pick from, each with its week; today marked. */
export function PlanSchedule({
  plan,
  weekday,
  disabled,
  onSchedule,
}: {
  plan: TrainingPlan;
  weekday: number | null;
  disabled: boolean;
  onSchedule: (schedule: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t("training.weeklySchedule")}
      className="grid grid-cols-1 gap-2.5 @2xl:grid-cols-3"
    >
      {SCHEDULE_IDS.map((id) => (
        <ScheduleOption
          key={id}
          id={id}
          selected={plan.schedule === id}
          weekday={weekday}
          disabled={disabled}
          onPick={() => onSchedule(id)}
        />
      ))}
    </div>
  );
}

/** The attributes the team's focus trains, in the player's words. */
function focusAttrs(t: ReturnType<typeof useTranslation>["t"], focus: string): string[] {
  return (TRAINING_FOCUS_ATTRS[focus] ?? []).map((attr) => t(`common.attributes.${attr}`));
}

/** The six focuses, then what the chosen one trains. */
export function PlanFocus({
  plan,
  disabled,
  onFocus,
}: {
  plan: TrainingPlan;
  disabled: boolean;
  onFocus: (focus: string) => void;
}) {
  const { t } = useTranslation();
  const attrs = focusAttrs(t, plan.focus);
  return (
    <div className="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label={t("training.trainingFocus")}
        className="grid grid-cols-3 gap-2 @3xl:grid-cols-6"
      >
        {TRAINING_FOCUS_IDS.map((id) => {
          const selected = plan.focus === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onFocus(id)}
              className={`flex flex-col items-center gap-1.5 px-1.5 py-3 ${optionClass(selected)} ${
                selected
                  ? "text-primary-700 dark:text-primary-300"
                  : "text-gray-700 dark:text-gray-200"
              }`}
            >
              {TRAINING_FOCUS_ICONS[id]}
              <span className="font-heading text-sm font-bold uppercase tracking-wider">
                {t(`training.focuses.${id}.label`)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t(`training.focuses.${plan.focus}.desc`)}
          {attrs.length > 0 && ":"}
        </span>
        {attrs.map((attr) => (
          <span
            key={attr}
            className="rounded-md bg-primary-50 px-2 py-0.5 font-heading text-xs font-semibold uppercase tracking-wider text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
          >
            {attr}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The three intensities of the schedule's days, each with what it does. */
export function PlanIntensity({
  plan,
  disabled,
  onIntensity,
}: {
  plan: TrainingPlan;
  disabled: boolean;
  onIntensity: (intensity: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t("training.intensity")}
      className="grid grid-cols-1 gap-2.5 @2xl:grid-cols-3"
    >
      {INTENSITY_IDS.map((id) => {
        const selected = plan.intensity === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onIntensity(id)}
            className={`flex flex-col gap-1 px-3.5 py-3 ${optionClass(selected)}`}
          >
            <span
              className={`font-heading text-base font-bold uppercase tracking-wider ${INTENSITY_TONES[id]}`}
            >
              {t(`training.intensities.${id}.label`)}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t(`training.intensities.${id}.desc`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** What the plan adds up to: the focus, the attributes it trains and the intensity. */
export function PlanSummary({ plan }: { plan: TrainingPlan }) {
  const { t } = useTranslation();
  const attrs = focusAttrs(t, plan.focus);
  return (
    <Trans
      i18nKey={
        attrs.length > 0 ? "online.training.plan.summary" : "online.training.plan.summaryNoAttrs"
      }
      values={{
        focus: t(`training.focuses.${plan.focus}.label`),
        attrs: attrs.join(", "),
        intensity: t(`training.intensities.${plan.intensity}.label`),
      }}
      components={{ strong: <strong className="text-gray-900 dark:text-white" /> }}
      tOptions={{ interpolation: { escapeValue: true } }}
      shouldUnescape
    />
  );
}

/** A schedule: its icon and name, its week with today marked, and what it means. */
function ScheduleOption({
  id,
  selected,
  weekday,
  disabled,
  onPick,
}: {
  id: string;
  selected: boolean;
  weekday: number | null;
  disabled: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const week = scheduleWeek(id);
  const trains = week.filter(Boolean).length;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onPick}
      className={`flex flex-col gap-2 px-3.5 py-3 ${optionClass(selected)}`}
    >
      <span className={`flex items-center gap-2 ${SCHEDULE_TONES[id]}`}>
        <span aria-hidden="true" className="[&>svg]:h-4 [&>svg]:w-4">
          {SCHEDULE_ICONS[id]}
        </span>
        <span className="font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white">
          {t(`training.schedules.${id}.label`)}
        </span>
      </span>
      <span
        role="img"
        aria-label={
          weekday === null
            ? t("online.training.plan.weekAria", { train: trains, rest: 7 - trains })
            : t("online.training.plan.weekAriaToday", {
                train: trains,
                rest: 7 - trains,
                day: t(`training.days.${DAY_KEYS[weekday]}`),
                type: week[weekday] ? t("training.aTrainingDay") : t("training.aRestDay"),
              })
        }
        className="grid grid-cols-7 gap-0.5"
      >
        {week.map((training, index) => (
          <span key={DAY_KEYS[index]} className="flex flex-col items-center gap-0.5">
            <span
              className={`h-2 w-full rounded-sm ${
                training
                  ? selected
                    ? "bg-primary-500"
                    : "bg-gray-400 dark:bg-slate-600"
                  : "border border-gray-300 dark:border-slate-600"
              }`}
            />
            <span
              className={`text-[10px] ${
                index === weekday
                  ? "font-bold text-gray-900 dark:text-white"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {t(`training.days.${DAY_KEYS[index]}`)}
            </span>
          </span>
        ))}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {t(`training.schedules.${id}.desc`)}
      </span>
    </button>
  );
}
