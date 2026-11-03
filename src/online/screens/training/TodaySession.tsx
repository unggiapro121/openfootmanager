import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bot, CalendarCheck, Circle, Hand, Heart, Info, Moon } from "lucide-react";
import { Button } from "../../../components/ui";
import type { MyClubView, TrainingDayView } from "../../api";
import { useOnlineNow } from "../../clock";
import { formatKickoffClock } from "../../format";
import { refreshClub, useOnlineStore } from "../../store/onlineStore";
import { SEASON_DAYS } from "../shellNav";
import { useCountdownText } from "../useCountdownText";
import ExtraEntry from "./ExtraEntry";
import ExtraTraining from "./ExtraTraining";
import MainSession from "./MainSession";
import { DAY_PENDING, displayDay, matchTodayKickoff } from "./todayText";
import { DAY_KEYS } from "../../../components/training/trainingOptions";
import { isScheduleDay, type StripDay, stripDays } from "./trainingView";
import { useDayPendingPoll } from "./useDayPendingPoll";

const ignore = () => undefined;

type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * Today's training in a season that rests clubs by blocks (design tap-luyen.html; C-8 C8-4,
 * C8-5; C-12a C12-1): how today stands, the sessions of the last seven days and today, when
 * condition changes next and how it works; beside it the day's own session as the plan holds it
 * and the way into extra sessions. The card only reads the server: it computes no condition, cap
 * or recovery (F10). The day's session is not pressed by hand any more (C12-1).
 */
export default function TodaySession({
  club,
  trainingDay,
}: {
  club: MyClubView;
  trainingDay: TrainingDayView;
}) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const season = useOnlineStore((state) => state.season);
  const weekday = season?.weekday ?? null;
  const [notesOpen, setNotesOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
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

  return (
    <section
      aria-labelledby="training-today-title"
      className="overflow-hidden rounded-2xl border border-t-4 border-gray-200 border-t-primary-500 bg-white shadow-sm dark:border-navy-600 dark:border-t-primary-500 dark:bg-navy-800"
    >
      <div className="flex flex-wrap items-stretch gap-6 px-6 py-5">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3.5">
          <div role="status" className="flex flex-col gap-1">
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
              {kicker}
            </span>
            <h2
              id="training-today-title"
              className="font-heading text-3xl font-bold uppercase leading-none tracking-wide text-gray-900 dark:text-white"
            >
              {statusText(t, trainingDay)}
            </h2>
            {scheduleDay !== null && (
              <span className="text-[13px] text-gray-600 dark:text-gray-400">
                {t(
                  scheduleDay
                    ? "online.training.today.scheduleDay"
                    : "online.training.today.scheduleRest",
                  {
                    schedule: t(`training.schedules.${club.trainingPlan.schedule}.label`),
                  },
                )}
              </span>
            )}
          </div>
          <Strip trainingDay={trainingDay} />
          <div className="flex flex-wrap items-center gap-2">
            <NextRecovery at={trainingDay.nextRecoveryAt} />
            <button
              type="button"
              aria-expanded={notesOpen}
              aria-controls="training-today-notes"
              onClick={() => setNotesOpen(!notesOpen)}
              className="inline-flex h-7.5 items-center gap-1.5 rounded-full border border-gray-300 px-2.5 text-xs text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-navy-600 dark:text-gray-400 dark:hover:bg-navy-700"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              {t("online.training.today.notesToggle")}
            </button>
          </div>
          {pending && slow && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void refreshClub().catch(ignore)}
            >
              {t("online.training.today.reload")}
            </Button>
          )}
        </div>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-3">
          {kickoff && (
            <p
              role="note"
              className="flex items-start gap-2.5 rounded-lg bg-accent-50 px-3 py-2.5 text-[13px] leading-snug text-accent-800 dark:bg-accent-900/40 dark:text-accent-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t("online.training.today.matchToday", {
                time: formatKickoffClock(kickoff, now, i18n.language),
              })}
            </p>
          )}
          <MainSession
            plan={club.trainingPlan}
            scheduleDay={scheduleDay}
            keeperDrill={trainingDay.keeperDrill}
          />
          {trainingDay.extra && (
            <ExtraEntry today={trainingDay.extra.today} onOpen={() => setExtraOpen(true)} />
          )}
        </div>
      </div>
      {notesOpen && <TodayNotes cap={trainingDay.sessionsCap} />}
      {extraOpen && trainingDay.extra && (
        <ExtraTraining
          club={club}
          trainingDay={trainingDay}
          extra={trainingDay.extra}
          onClose={() => setExtraOpen(false)}
        />
      )}
    </section>
  );
}

/** Today's session as the player reads it: not yet, on the schedule, pressed, or before him. */
export function statusText(t: Translate, trainingDay: TrainingDayView): string {
  switch (trainingDay.today) {
    case undefined:
      return t("online.training.today.statusNone");
    case "auto":
      return t("online.training.today.statusAuto");
    case "bot":
      return t("online.training.today.statusBot");
    case "rest":
      return t("online.training.today.statusRest");
    default:
      // A day pressed by hand before extra sessions came in (C-8).
      return t("online.training.today.statusManual");
  }
}

const KIND_ICONS = { manual: Hand, auto: CalendarCheck, bot: Bot, rest: Moon } as const;
const KIND_TONES = {
  manual: "text-primary-600 dark:text-primary-400",
  auto: "text-primary-500 dark:text-primary-300",
  bot: "text-gray-500 dark:text-gray-400",
  rest: "text-accent-700 dark:text-accent-300",
} as const;
const KINDS = ["manual", "auto", "bot", "rest", "none"] as const;

function kindKey(kind: string | null): (typeof KINDS)[number] {
  return kind && kind in KIND_ICONS ? (kind as keyof typeof KIND_ICONS) : "none";
}

/** The sessions of the last seven days against the cap, then a cell per day and today's last. */
function Strip({ trainingDay }: { trainingDay: TrainingDayView }) {
  const { t } = useTranslation();
  const days = stripDays(trainingDay);
  const cap = trainingDay.sessionsCap;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] text-gray-700 dark:text-gray-300">
          {t("online.training.today.sessions", { count: trainingDay.sessionsLast7, cap })}
        </span>
        <span aria-hidden="true" className="inline-flex gap-0.75">
          {Array.from({ length: cap }, (_, index) => (
            <span
              key={index}
              className={`h-1.5 w-3.5 rounded-full ${
                index < trainingDay.sessionsLast7
                  ? "bg-primary-500"
                  : "bg-gray-200 dark:bg-navy-600"
              }`}
            />
          ))}
        </span>
      </div>
      {days.length > 0 && (
        <ol aria-label={t("online.training.today.stripLabel")} className="grid grid-cols-8 gap-1.5">
          {days.map((cell) => (
            <StripCell key={cell.day} cell={cell} />
          ))}
        </ol>
      )}
    </div>
  );
}

export function StripCell({ cell }: { cell: StripDay }) {
  const { t } = useTranslation();
  const kind = kindKey(cell.kind);
  const Icon = kind === "none" ? null : KIND_ICONS[kind];
  const what =
    cell.isToday && kind === "none"
      ? t("online.training.today.kind.today")
      : t(`online.training.today.kind.${kind}`);
  const label = `${t("online.training.today.dayCell", { day: displayDay(cell.day) })}: ${what}`;
  return (
    <li
      aria-label={label}
      title={label}
      aria-current={cell.isToday ? "date" : undefined}
      className={`flex flex-col items-center gap-1 rounded-lg border py-1.5 ${
        cell.isToday
          ? "border-primary-500 bg-primary-50 dark:bg-primary-900/40"
          : "border-gray-200 bg-gray-50 dark:border-navy-600 dark:bg-navy-700"
      }`}
    >
      <span
        className={`text-[11px] tabular-nums ${
          cell.isToday
            ? "font-semibold text-gray-900 dark:text-white"
            : "text-gray-500 dark:text-gray-400"
        }`}
      >
        {displayDay(cell.day)}
      </span>
      <span className="flex h-4 items-center" aria-hidden="true">
        {Icon ? (
          <Icon className={`h-4 w-4 ${KIND_TONES[kind as keyof typeof KIND_TONES]}`} />
        ) : cell.isToday ? (
          <Circle className="h-2.5 w-2.5 text-gray-700 dark:text-white" strokeWidth={3} />
        ) : (
          <span className="h-3 w-3 rounded-sm border border-dashed border-gray-300 dark:border-gray-600" />
        )}
      </span>
    </li>
  );
}

/** When condition changes next; once that moment has passed, until the club is read again. */
export function NextRecovery({ at }: { at: string }) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const left = useCountdownText(at);
  return (
    <span
      role="timer"
      className="inline-flex h-7.5 items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 px-2.5 text-xs text-gray-700 dark:border-navy-600 dark:bg-navy-900 dark:text-gray-300"
    >
      <Heart className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
      {left
        ? t("online.training.today.nextRecovery", {
            time: formatKickoffClock(at, now, i18n.language),
            left,
          })
        : t("online.training.today.updating")}
    </span>
  );
}

/** How it works: when the day's session counts, the fatigue floor, stamina, the cap; a legend. */
export function TodayNotes({ cap }: { cap: number }) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const nextDayAt = useOnlineStore((state) => state.season?.nextDayAt);
  return (
    <div
      id="training-today-notes"
      className="flex flex-wrap gap-x-10 gap-y-5 border-t border-gray-200 bg-gray-50 px-6 py-4 text-[13px] text-gray-700 dark:border-navy-600 dark:bg-navy-900 dark:text-gray-300"
    >
      <ul className="flex flex-[2_1_420px] list-disc flex-col gap-1.5 pl-4.5 leading-snug">
        {nextDayAt && (
          <li>
            {t("online.training.today.noteDayTurn", {
              time: formatKickoffClock(nextDayAt, now, i18n.language),
            })}
          </li>
        )}
        <li>{t("online.training.today.noteFatigue")}</li>
        <li>{t("online.training.today.noteStamina")}</li>
        <li>{t("online.training.today.recentNote", { cap })}</li>
      </ul>
      <ul
        aria-label={t("online.training.today.legend")}
        className="grid flex-[1_1_220px] grid-cols-2 content-start gap-x-3 gap-y-1.5 text-xs text-gray-500 dark:text-gray-400"
      >
        {KINDS.map((kind) => {
          const Icon = kind === "none" ? null : KIND_ICONS[kind];
          return (
            <li key={kind} className="flex items-center gap-1.5">
              {Icon ? (
                <Icon className={`h-3.5 w-3.5 ${KIND_TONES[kind as keyof typeof KIND_TONES]}`} />
              ) : (
                <span
                  className="h-3 w-3 rounded-sm border border-dashed border-gray-400 dark:border-gray-600"
                  aria-hidden="true"
                />
              )}
              {t(`online.training.today.kind.${kind}`)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
