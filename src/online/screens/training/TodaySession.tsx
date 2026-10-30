import { useTranslation } from "react-i18next";
import { Bot, CalendarCheck, Hand, Moon } from "lucide-react";
import { Button, Card, CardBody, CardHeader } from "../../../components/ui";
import type { MyClubView, TrainingDayView } from "../../api";
import { useOnlineNow } from "../../clock";
import { formatKickoffClock } from "../../format";
import { refreshClub, useOnlineStore } from "../../store/onlineStore";
import { SEASON_DAYS } from "../shellNav";
import { useCountdownText } from "../useCountdownText";
import ExtraTraining from "./ExtraTraining";
import { DAY_PENDING, displayDay, type RecentDay, recentDays } from "./todayText";
import { useDayPendingPoll } from "./useDayPendingPoll";

const ignore = () => undefined;
const NOTE = "text-xs text-gray-500 dark:text-gray-400";

/**
 * Today's training in a season that rests clubs by blocks (C-8 C8-4, C8-5; C-12a C12-1): how the
 * day's own session went, extra sessions on top of it, the sessions of the last seven days, and
 * when condition changes next. The card only reads the server: it computes no condition, cap or
 * recovery (F10); the extra block warns, the server decides.
 */
export default function TodaySession({
  club,
  trainingDay,
}: {
  club: MyClubView;
  trainingDay: TrainingDayView;
}) {
  const { t } = useTranslation();
  const pending = trainingDay.refusal === DAY_PENDING || trainingDay.extra?.refusal === DAY_PENDING;
  const { slow } = useDayPendingPoll(pending);

  return (
    <Card accent="primary">
      <CardHeader>
        {trainingDay.day === undefined
          ? t("online.training.today.title")
          : t("online.training.today.titleDay", {
              day: displayDay(trainingDay.day),
              total: SEASON_DAYS,
            })}
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100" role="status">
          {statusText(t, trainingDay)}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t("online.training.today.sessions", {
            count: trainingDay.sessionsLast7,
            cap: trainingDay.sessionsCap,
          })}
        </p>
        {pending && slow && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshClub().catch(ignore)}
          >
            {t("online.training.today.reload")}
          </Button>
        )}
        {trainingDay.extra && (
          <ExtraTraining club={club} trainingDay={trainingDay} extra={trainingDay.extra} />
        )}
        <RecentStrip days={recentDays(trainingDay)} cap={trainingDay.sessionsCap} />
        <NextRecovery at={trainingDay.nextRecoveryAt} />
        <TodayNotes />
      </CardBody>
    </Card>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

/** Today's session as the player reads it: not yet, on the schedule, pressed, or before him. */
function statusText(t: Translate, trainingDay: TrainingDayView): string {
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
const KINDS = ["manual", "auto", "bot", "rest", "none"] as const;

function kindKey(kind: string | null): (typeof KINDS)[number] {
  return kind && kind in KIND_ICONS ? (kind as keyof typeof KIND_ICONS) : "none";
}

/** The seven days before today, one cell each; a day with no row stays empty. */
function RecentStrip({ days, cap }: { days: RecentDay[]; cap: number }) {
  const { t } = useTranslation();
  if (days.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
        {t("online.training.today.recentTitle")}
      </p>
      <ol className="flex flex-wrap gap-2">
        {days.map((cell) => {
          const kind = kindKey(cell.kind);
          const Icon = kind === "none" ? null : KIND_ICONS[kind];
          const label = `${t("online.training.today.dayCell", { day: displayDay(cell.day) })}: ${t(`online.training.today.kind.${kind}`)}`;
          return (
            <li
              key={cell.day}
              aria-label={label}
              title={label}
              className="flex w-12 flex-col items-center gap-1 rounded-md border border-gray-200 py-1 text-xs text-gray-600 dark:border-navy-600 dark:text-gray-300"
            >
              <span className="tabular-nums">{displayDay(cell.day)}</span>
              {Icon ? (
                <Icon className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden />
              ) : (
                <span className="h-4 w-4" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
      <ul className={`flex flex-wrap gap-x-4 gap-y-1 ${NOTE}`}>
        {KINDS.map((kind) => {
          const Icon = kind === "none" ? null : KIND_ICONS[kind];
          return (
            <li key={kind} className="flex items-center gap-1">
              {Icon ? (
                <Icon className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <span
                  className="h-3.5 w-3.5 rounded-sm border border-gray-300 dark:border-navy-600"
                  aria-hidden
                />
              )}
              {t(`online.training.today.kind.${kind}`)}
            </li>
          );
        })}
      </ul>
      <p className={NOTE}>{t("online.training.today.recentNote", { cap })}</p>
    </div>
  );
}

/** When condition changes next; once that moment has passed, until the club is read again. */
function NextRecovery({ at }: { at: string }) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const left = useCountdownText(at);
  return (
    <p className="text-sm text-gray-700 dark:text-gray-300">
      {left
        ? t("online.training.today.nextRecovery", {
            time: formatKickoffClock(at, now, i18n.language),
            left,
          })
        : t("online.training.today.updating")}
    </p>
  );
}

/** Three fixed notes: when the day's session counts, the fatigue floor, stamina (C8-9, C8-10). */
function TodayNotes() {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const nextDayAt = useOnlineStore((state) => state.season?.nextDayAt);
  return (
    <ul className={`list-disc space-y-1 pl-5 ${NOTE}`}>
      {nextDayAt && (
        <li>
          {t("online.training.today.noteDayTurn", {
            time: formatKickoffClock(nextDayAt, now, i18n.language),
          })}
        </li>
      )}
      <li>{t("online.training.today.noteFatigue")}</li>
      <li>{t("online.training.today.noteStamina")}</li>
    </ul>
  );
}
