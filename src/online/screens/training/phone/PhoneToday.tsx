import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronRight, Info } from "lucide-react";
import { DAY_KEYS } from "../../../../components/training/trainingOptions";
import type { MyClubView, TrainingDayView, TrainingPlan } from "../../../api";
import { useOnlineNow } from "../../../clock";
import { formatKickoffClock } from "../../../format";
import { refreshClub, useOnlineStore } from "../../../store/onlineStore";
import { FOCUS } from "../../mobile/PhoneSheet";
import { SEASON_DAYS } from "../../shellNav";
import { useMainSessionNote } from "../MainSession";
import { NextRecovery, StripCell, statusText, TodayNotes } from "../TodaySession";
import type { ExtraOutcome } from "../extraResult";
import { DAY_PENDING, displayDay, matchTodayKickoff } from "../todayText";
import { isScheduleDay, stripDays } from "../trainingView";
import { useDayPendingPoll } from "../useDayPendingPoll";
import { SCHEDULE_TONES } from "../WeeklyPlan";
import PhoneExtra from "./PhoneExtra";
import { PhoneExtraEntry } from "./PhoneExtraEntry";

export const KEY = "online.training.phone";
export type PlanTab = "sched" | "focus";

const CARD = "rounded-[14px] border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800";
const ignore = () => undefined;

/**
 * Today on a phone (design m-tap-luyen "Hôm nay"): how today stands with the sessions held in
 * the last seven days against the cap, a cell per day, when condition changes next and how it
 * works; then the day's own session as the plan holds it (read, never pressed: C-12 C12-1), its
 * tiles leading to the tab that changes them, and the way into extra sessions.
 */
export function PhoneToday({
  club,
  trainingDay,
  onGo,
}: {
  club: MyClubView;
  trainingDay: TrainingDayView;
  onGo: (tab: PlanTab) => void;
}) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const season = useOnlineStore((state) => state.season);
  const weekday = season?.weekday ?? null;
  const [notesOpen, setNotesOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [outcome, setOutcome] = useState<ExtraOutcome | null>(null);
  const pending = trainingDay.refusal === DAY_PENDING || trainingDay.extra?.refusal === DAY_PENDING;
  const { slow } = useDayPendingPoll(pending);
  const kickoff = matchTodayKickoff(club, season?.nextDayAt, now);
  const scheduleDay = isScheduleDay(club.trainingPlan.schedule, weekday);
  const kicker = [
    trainingDay.day === undefined
      ? t("online.training.today.title")
      : t("online.training.today.kicker", { day: displayDay(trainingDay.day), total: SEASON_DAYS }),
    weekday === null ? null : t(`training.days.${DAY_KEYS[weekday]}`),
  ]
    .filter(Boolean)
    .join(" · ");
  const days = stripDays(trainingDay);
  const cap = trainingDay.sessionsCap;

  return (
    <div className="flex flex-col gap-3">
      <section aria-labelledby="phone-today-title" className={`${CARD} flex flex-col gap-3 p-3.5`}>
        <div className="flex items-start justify-between gap-3">
          <div role="status" className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
              {kicker}
            </span>
            <h2
              id="phone-today-title"
              className="font-heading text-2xl font-bold uppercase leading-none tracking-wide text-gray-900 dark:text-white"
            >
              {statusText(t, trainingDay)}
            </h2>
            {scheduleDay !== null && (
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {t(
                  scheduleDay
                    ? "online.training.today.scheduleDay"
                    : "online.training.today.scheduleRest",
                  { schedule: t(`training.schedules.${club.trainingPlan.schedule}.label`) },
                )}
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="font-heading text-[28px] font-bold leading-none tabular-nums text-gray-900 dark:text-white">
              {`${trainingDay.sessionsLast7}/${cap}`}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {t(`${KEY}.sessionsIn7`)}
            </span>
            <span aria-hidden="true" className="flex gap-0.75">
              {Array.from({ length: cap }, (_, index) => (
                <span
                  key={`pip-${index + 1}`}
                  className={`h-1.5 w-3 rounded-full ${index < trainingDay.sessionsLast7 ? "bg-primary-500" : "bg-gray-200 dark:bg-navy-600"}`}
                />
              ))}
            </span>
          </div>
        </div>
        {days.length > 0 && (
          <ol aria-label={t("online.training.today.stripLabel")} className="grid grid-cols-8 gap-1">
            {days.map((cell) => (
              <StripCell key={cell.day} cell={cell} />
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <NextRecovery at={trainingDay.nextRecoveryAt} />
          <button
            type="button"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen(!notesOpen)}
            className={`inline-flex h-7.5 items-center gap-1.5 rounded-full border border-gray-300 px-2.5 text-xs text-gray-600 dark:border-navy-600 dark:text-gray-400 ${FOCUS}`}
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            {t("online.training.today.notesToggle")}
          </button>
        </div>
        {pending && slow && (
          <button
            type="button"
            onClick={() => void refreshClub().catch(ignore)}
            className={`self-start rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 dark:border-navy-600 dark:text-gray-200 ${FOCUS}`}
          >
            {t("online.training.today.reload")}
          </button>
        )}
        {notesOpen && (
          <div className="-mx-3.5 -mb-3.5 overflow-hidden rounded-b-[14px]">
            <TodayNotes cap={cap} />
          </div>
        )}
      </section>
      {kickoff && (
        <p
          role="note"
          className="flex items-start gap-2.5 rounded-xl bg-accent-50 px-3 py-2.5 text-[13px] leading-snug text-accent-800 dark:bg-accent-900/40 dark:text-accent-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("online.training.today.matchToday", {
            time: formatKickoffClock(kickoff, now, i18n.language),
          })}
        </p>
      )}
      <PlanTiles
        plan={club.trainingPlan}
        scheduleDay={scheduleDay}
        keeperDrill={trainingDay.keeperDrill}
        onGo={onGo}
      />
      {trainingDay.extra && (
        <PhoneExtraEntry
          extra={trainingDay.extra}
          players={club.players}
          outcome={outcome}
          onOpen={() => setExtraOpen(true)}
        />
      )}
      {extraOpen && trainingDay.extra && (
        <PhoneExtra
          club={club}
          trainingDay={trainingDay}
          extra={trainingDay.extra}
          outcome={outcome}
          onOutcome={setOutcome}
          onClose={() => setExtraOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The day's own session as the plan holds it: the schedule, the focus and the intensity, each a
 * tile that opens the tab where it changes; and when the session runs.
 */
export function PlanTiles({
  plan,
  scheduleDay,
  keeperDrill,
  onGo,
}: {
  plan: TrainingPlan;
  scheduleDay: boolean | null;
  /** The season's ruleset has the goalkeepers' own drill (E5-6c E56c-14). */
  keeperDrill: boolean;
  onGo: (tab: PlanTab) => void;
}) {
  const { t } = useTranslation();
  const note = useMainSessionNote(scheduleDay, true);
  const tiles: { label: string; value: string; tone: string; tab: PlanTab }[] = [
    {
      label: t("training.weeklySchedule"),
      value: t(`training.schedules.${plan.schedule}.label`),
      tone: SCHEDULE_TONES[plan.schedule] ?? "",
      tab: "sched",
    },
    {
      label: t("training.effectiveFocus"),
      value: t(`training.focuses.${plan.focus}.label`),
      tone: "text-gray-900 dark:text-white",
      tab: "focus",
    },
    {
      label: t("training.intensity"),
      value: t(`training.intensities.${plan.intensity}.label`),
      tone: "text-gray-900 dark:text-white",
      tab: "sched",
    },
  ];
  return (
    <section aria-labelledby="phone-main-title" className={`${CARD} flex flex-col gap-2.5 p-3.5`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id="phone-main-title"
          className="font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white"
        >
          {t("online.training.main.title")}
        </h2>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {t(`${KEY}.planInUse`)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {tiles.map((tile) => (
          <button
            key={tile.label}
            type="button"
            onClick={() => onGo(tile.tab)}
            className={`flex flex-col items-start gap-0.5 rounded-[10px] border border-gray-200 bg-gray-50 px-2 py-2 text-left dark:border-navy-700 dark:bg-navy-900 ${FOCUS}`}
          >
            <span
              className={`font-heading text-sm font-bold uppercase leading-tight tracking-wide ${tile.tone}`}
            >
              {tile.value}
            </span>
            <span className="flex w-full items-center justify-between gap-1 text-[10px] text-gray-500 dark:text-gray-400">
              {tile.label}
              <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
      {keeperDrill && (
        <p className="text-xs leading-snug text-gray-600 dark:text-gray-300">
          {t("online.training.main.keeperDrill")}
        </p>
      )}
      <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">{note}</p>
    </section>
  );
}
