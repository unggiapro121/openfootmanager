import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bot, CalendarCheck, Hand, Moon } from "lucide-react";
import { INTENSITY_IDS } from "../../../components/training/trainingOptions";
import { Button, Card, CardBody, CardHeader, InjuryBadge } from "../../../components/ui";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { MyClubView, TrainingDayView, TrainingSessionView } from "../../api";
import { online } from "../../client";
import { useOnlineNow } from "../../clock";
import { OnlineApiError } from "../../errors";
import { formatKickoffClock } from "../../format";
import { refreshClub, tracked, useOnlineStore } from "../../store/onlineStore";
import { SEASON_DAYS } from "../OnlineHeader";
import { useActionKey } from "../useActionKey";
import { useCountdownText } from "../useCountdownText";
import {
  DAY_PENDING,
  displayDay,
  isScheduledRest,
  matchTodayKickoff,
  type RecentDay,
  recentDays,
  refusalText,
  sessionSummary,
  viewRefusalParams,
} from "./todayText";
import { useDayPendingPoll } from "./useDayPendingPoll";

const ignore = () => undefined;
const NOTE = "text-xs text-gray-500 dark:text-gray-400";

/**
 * Today's session of a season that rests clubs by blocks (C-8 C8-4, C8-5): hold it now, at an
 * intensity for this session alone, or see why not; the sessions of the last seven days; and
 * when condition changes next. The card only reads the server: it computes no condition, cap or
 * recovery (F10). A session's answer is shown as it came back, and the club is read again for
 * the players' new condition.
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
  const offline = useOnlineStore((state) => state.network === "offline");
  const [intensity, setIntensity] = useState<string>(club.trainingPlan.intensity);
  const [sending, setSending] = useState(false);
  // A failure is shown until the club is read again: the view then says why, as it is now.
  const [failure, setFailure] = useState<{ error: unknown; seen: TrainingDayView } | null>(null);
  const [result, setResult] = useState<TrainingSessionView | null>(null);
  const key = useActionKey();
  const pending = trainingDay.refusal === DAY_PENDING;
  const { slow } = useDayPendingPoll(pending);
  const language = i18n.language;

  const press = async () => {
    const request = { intensity };
    setSending(true);
    setFailure(null);
    try {
      const view = await key.run(
        (idempotencyKey) => tracked(() => online.clubs.holdSession(request, idempotencyKey)),
        JSON.stringify(request),
      );
      setResult(view);
      const current = useOnlineStore.getState().club;
      if (current) {
        useOnlineStore.getState().setClub({ ...current, trainingDay: view.trainingDay });
      }
      void refreshClub().catch(ignore);
    } catch (error) {
      setFailure({ error, seen: trainingDay });
      // Every 409 means the card's view was stale: read it again.
      if (error instanceof OnlineApiError && error.status === 409) {
        void refreshClub().catch(ignore);
      }
    } finally {
      setSending(false);
    }
  };

  const shownFailure = failure && failure.seen === trainingDay ? failure.error : null;
  const reason = shownFailure
    ? failureText(t, language, shownFailure, now)
    : trainingDay.canTrain
      ? null
      : refusalText(
          t,
          language,
          trainingDay.refusal ?? "",
          viewRefusalParams(trainingDay, club),
          now,
        );
  const matchKickoff = trainingDay.canTrain
    ? matchTodayKickoff(club, season?.nextDayAt, now)
    : null;
  const restDay =
    trainingDay.canTrain && isScheduledRest(club.trainingPlan.schedule, season?.weekday);
  const heldNow = result !== null && result.day === trainingDay.day ? result : null;

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
          {statusText(t, trainingDay, heldNow)}
        </p>
        <p className={NOTE}>
          {t("online.training.today.noExtra", { cap: trainingDay.sessionsCap })}
        </p>
        {matchKickoff && (
          <p
            role="note"
            className="flex items-start gap-2 rounded-md border border-accent-400/60 bg-accent-50 px-3 py-2 text-sm text-gray-800 dark:border-accent-400/40 dark:bg-accent-500/10 dark:text-gray-100"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
            {t("online.training.today.matchToday", {
              time: formatKickoffClock(matchKickoff, now, language),
            })}
          </p>
        )}
        {restDay && (
          <p className={NOTE}>
            {t("online.training.today.scheduledRest", { cap: trainingDay.sessionsCap })}
          </p>
        )}
        <IntensityPicker
          value={intensity}
          disabled={sending || !trainingDay.canTrain}
          onChange={setIntensity}
        />
        <div className="space-y-2">
          <Button
            type="button"
            disabled={!trainingDay.canTrain || sending || offline}
            onClick={() => void press()}
          >
            {t("online.training.today.press")}
          </Button>
          {reason && (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {reason}
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
            </div>
          )}
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t("online.training.today.sessions", {
              count: trainingDay.sessionsLast7,
              cap: trainingDay.sessionsCap,
            })}
          </p>
        </div>
        {heldNow && <SessionResult club={club} result={heldNow} />}
        <RecentStrip days={recentDays(trainingDay)} cap={trainingDay.sessionsCap} />
        <NextRecovery at={trainingDay.nextRecoveryAt} />
        <TodayNotes nextDayAt={season?.nextDayAt} />
      </CardBody>
    </Card>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

/** What a failed press says: the card's own sentence for a refusal, the shared one otherwise. */
function failureText(t: Translate, language: string, error: unknown, now: number): string {
  if (error instanceof OnlineApiError && error.status === 409) {
    return refusalText(t, language, error.code, error.params, now);
  }
  return resolveBackendError(error);
}

/** Today's session as the player reads it: not yet, pressed, on the schedule, or before him. */
function statusText(
  t: Translate,
  trainingDay: TrainingDayView,
  heldNow: TrainingSessionView | null,
): string {
  switch (trainingDay.today) {
    case undefined:
      return t("online.training.today.statusNone");
    case "manual":
      // The view has no intensity; only the answer just received does (C-8 Qc8-5).
      return heldNow
        ? t("online.training.today.statusManualWith", {
            intensity: t(`training.intensities.${heldNow.intensity}.label`),
          })
        : t("online.training.today.statusManual");
    case "auto":
      return t("online.training.today.statusAuto");
    case "bot":
      return t("online.training.today.statusBot");
    case "rest":
      return t("online.training.today.statusRest");
    default:
      return t("online.training.today.statusManual");
  }
}

/** The intensity of this session alone: the plan's by default, the plan unchanged. */
function IntensityPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (intensity: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-semibold text-gray-700 dark:text-gray-200">
        {t("online.training.today.intensity")}
      </legend>
      <div className="flex flex-wrap gap-2">
        {INTENSITY_IDS.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={id === value ? "primary" : "outline"}
            aria-pressed={id === value}
            disabled={disabled}
            onClick={() => onChange(id)}
          >
            {t(`training.intensities.${id}.label`)}
          </Button>
        ))}
      </div>
      <p className={NOTE}>{t("online.training.today.intensityNote")}</p>
    </fieldset>
  );
}

/** The answer to the press: how many players went down, up or stayed, and each of them. */
function SessionResult({ club, result }: { club: MyClubView; result: TrainingSessionView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const summary = sessionSummary(result.players);
  const byId = new Map(club.players.map((player) => [player.id, player]));
  return (
    <div className="space-y-2 rounded-md bg-gray-50 p-3 dark:bg-navy-800">
      <p className="text-sm text-gray-800 dark:text-gray-100">
        {t("online.training.today.summary", summary)}
      </p>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((shown) => !shown)}>
        {open ? t("online.training.today.hidePlayers") : t("online.training.today.showPlayers")}
      </Button>
      {open && (
        <table className="w-full text-left text-sm text-gray-700 dark:text-gray-200">
          <thead>
            <tr>
              <th className="py-1 font-semibold">{t("online.training.today.player")}</th>
              <th className="py-1 text-right font-semibold">{t("online.training.today.before")}</th>
              <th className="py-1 text-right font-semibold">{t("online.training.today.after")}</th>
            </tr>
          </thead>
          <tbody>
            {result.players.map((line) => {
              const player = byId.get(line.playerId);
              return (
                <tr key={line.playerId}>
                  <td className="flex items-center gap-2 py-1">
                    {player?.matchName ?? line.playerId}
                    {player?.injury && (
                      <InjuryBadge
                        injury={{
                          name: player.injury.name,
                          days_remaining: player.injury.daysRemaining,
                        }}
                        showName={false}
                      />
                    )}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {Math.round(line.conditionBefore)}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {Math.round(line.conditionAfter)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
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

/** Three fixed notes: the day not pressed, the fatigue floor, stamina (C-8 C8-9, C8-10). */
function TodayNotes({ nextDayAt }: { nextDayAt: string | undefined }) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
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
