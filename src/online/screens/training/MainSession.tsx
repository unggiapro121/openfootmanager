import { useTranslation } from "react-i18next";
import type { TrainingPlan } from "../../api";
import { useOnlineNow } from "../../clock";
import { formatKickoffClock } from "../../format";
import { useOnlineStore } from "../../store/onlineStore";
import { planFocusLabel } from "./autoFocus";
import { SCHEDULE_TONES } from "./WeeklyPlan";

const TILE =
  "flex flex-col items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1.5 py-2 text-center dark:border-navy-600 dark:bg-navy-800";
const TILE_LABEL = "text-[11px] text-gray-500 dark:text-gray-400";
const TILE_VALUE = "font-heading text-sm font-bold uppercase tracking-wider";

/**
 * When the day's session runs, or that today rests: the line under the session's tiles. The
 * phone's tiles open the tab that changes them, so its line says to tap one (`onPhone`).
 */
export function useMainSessionNote(scheduleDay: boolean | null, onPhone = false): string {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const nextDayAt = useOnlineStore((state) => state.season?.nextDayAt);
  if (scheduleDay === false) return t("online.training.main.rest");
  const keys = onPhone
    ? { auto: "online.training.phone.mainAuto", autoNoTime: "online.training.phone.mainAutoNoTime" }
    : { auto: "online.training.main.auto", autoNoTime: "online.training.main.autoNoTime" };
  return nextDayAt
    ? t(keys.auto, { time: formatKickoffClock(nextDayAt, now, i18n.language) })
    : t(keys.autoNoTime);
}

/**
 * The day's own session as the weekly plan holds it (design tap-luyen.html "Buổi tập chính").
 * It is read, never pressed: the team trains on its schedule when the day turns (C-12 C12-1), so
 * the block says which schedule, focus and intensity that is, and when it runs. In a season whose
 * ruleset has the goalkeepers' drill (E5-6c E56c-14), it says goalkeepers also train their own.
 */
export default function MainSession({
  plan,
  scheduleDay,
  keeperDrill,
}: {
  plan: TrainingPlan;
  /** Today trains on the schedule; `null` while the weekday is unknown. */
  scheduleDay: boolean | null;
  /** The season's ruleset has the goalkeepers' own drill (`TrainingDayView.keeperDrill`). */
  keeperDrill: boolean;
}) {
  const { t } = useTranslation();
  const note = useMainSessionNote(scheduleDay);
  return (
    <section
      aria-labelledby="training-main-title"
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-navy-600 dark:bg-navy-700"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3
          id="training-main-title"
          className="font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white"
        >
          {t("online.training.main.title")}
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.training.main.fromPlan")}
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-1.5">
        <div className={TILE}>
          <dt className={TILE_LABEL}>{t("training.weeklySchedule")}</dt>
          <dd className={`${TILE_VALUE} ${SCHEDULE_TONES[plan.schedule] ?? ""}`}>
            {t(`training.schedules.${plan.schedule}.label`)}
          </dd>
        </div>
        <div className={TILE}>
          <dt className={TILE_LABEL}>{t("training.effectiveFocus")}</dt>
          <dd className={`${TILE_VALUE} text-gray-900 dark:text-white`}>
            {planFocusLabel(t, plan)}
          </dd>
        </div>
        <div className={TILE}>
          <dt className={TILE_LABEL}>{t("training.intensity")}</dt>
          <dd className={`${TILE_VALUE} text-gray-900 dark:text-white`}>
            {t(`training.intensities.${plan.intensity}.label`)}
          </dd>
        </div>
      </dl>
      {keeperDrill && (
        <p className="text-xs leading-snug text-gray-600 dark:text-gray-300">
          {t("online.training.main.keeperDrill")}
        </p>
      )}
      <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">{note}</p>
    </section>
  );
}
