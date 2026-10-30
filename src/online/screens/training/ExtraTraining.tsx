import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { INTENSITY_IDS } from "../../../components/training/trainingOptions";
import { Button, Checkbox } from "../../../components/ui";
import { resolveBackendError } from "../../../utils/backendI18n";
import type {
  ExtraDayView,
  ExtraSessionRequest,
  ExtraSessionView,
  MyClubView,
  SquadPlayerView,
  TrainingDayView,
} from "../../api";
import { online } from "../../client";
import { useOnlineNow } from "../../clock";
import { OnlineApiError } from "../../errors";
import { refreshClub, tracked, useOnlineStore } from "../../store/onlineStore";
import DailyGift from "../items/DailyGift";
import { useActionKey } from "../useActionKey";
import {
  ALL_SESSIONS,
  chosenInSquad,
  type ExtraChoice,
  focusFull,
  loadChoice,
  MATCH_CONDITION,
  namesOf,
  SESSION_CHOICES,
  saveChoice,
  startersUnderMatchCondition,
  stopReasonKey,
} from "./extraText";
import { matchTodayKickoff, refusalText, viewRefusalParams } from "./todayText";

const ignore = () => undefined;
const NOTE = "text-xs text-gray-500 dark:text-gray-400";
const LEGEND = "text-sm font-semibold text-gray-700 dark:text-gray-200";

type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * Extra sessions on top of the day's (C-12a C12-1…C12-6): the players to train (the whole squad
 * by default), the intensity (Low by default), how many sessions and the condition to keep, then
 * the press and each player's line of the answer. The server decides who trains; the card only
 * shows who it says will sit out, and warns of today's starters it would leave under 75.
 */
export default function ExtraTraining({
  club,
  trainingDay,
  extra,
}: {
  club: MyClubView;
  trainingDay: TrainingDayView;
  extra: ExtraDayView;
}) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const season = useOnlineStore((state) => state.season);
  const offline = useOnlineStore((state) => state.network === "offline");
  const clubId = club.club.id;
  const [choice, setChoiceState] = useState<ExtraChoice>(() => loadChoice(clubId));
  const [intensity, setIntensity] = useState<string>("Low");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; seen: ExtraDayView } | null>(null);
  const [result, setResult] = useState<ExtraSessionView | null>(null);
  const key = useActionKey();
  const chosen = chosenInSquad(choice.players, club.players);
  const matchKickoff = matchTodayKickoff(club, season?.nextDayAt, now);

  const setChoice = (next: ExtraChoice) => {
    setChoiceState(next);
    saveChoice(clubId, next);
  };
  const toggle = (playerId: string) => {
    const ids = new Set(chosen);
    if (ids.has(playerId)) ids.delete(playerId);
    else ids.add(playerId);
    setChoice({ ...choice, players: club.players.map((p) => p.id).filter((id) => ids.has(id)) });
  };

  const press = async () => {
    const request: ExtraSessionRequest = {
      intensity,
      players: chosen,
      sessions: choice.sessions,
      ...(choice.keepAbove === null ? {} : { keepAbove: choice.keepAbove }),
    };
    setSending(true);
    setFailure(null);
    try {
      const view = await key.run(
        (idempotencyKey) => tracked(() => online.clubs.extraSessions(request, idempotencyKey)),
        JSON.stringify(request),
      );
      setResult(view);
      const current = useOnlineStore.getState().club;
      if (current) {
        useOnlineStore.getState().setClub({ ...current, trainingDay: view.trainingDay });
      }
      void refreshClub().catch(ignore);
    } catch (error) {
      setFailure({ error, seen: extra });
      // Every 409 means the card's view was stale: read it again.
      if (error instanceof OnlineApiError && error.status === 409) {
        void refreshClub().catch(ignore);
      }
    } finally {
      setSending(false);
    }
  };

  const shownFailure = failure && failure.seen === extra ? failure.error : null;
  const reason = shownFailure
    ? failureText(t, i18n.language, shownFailure, now)
    : extra.canPress
      ? null
      : refusalText(
          t,
          i18n.language,
          extra.refusal ?? "",
          viewRefusalParams(trainingDay, club),
          now,
        );
  const starters = matchKickoff
    ? startersUnderMatchCondition({
        players: club.players,
        chosen,
        startingXiIds: club.setup.startingXiIds,
        extra,
        intensity,
        sessions: choice.sessions,
        keepAbove: choice.keepAbove,
      })
    : [];
  const full = focusFull(club.players, chosen, club.trainingPlan);

  return (
    <section
      aria-labelledby="extra-training-title"
      className="space-y-4 rounded-md border border-gray-200 p-3 dark:border-navy-600"
    >
      <div className="space-y-1">
        <h3
          id="extra-training-title"
          className="font-heading text-base uppercase tracking-wider text-gray-800 dark:text-gray-100"
        >
          {t("online.training.extra.title")}
        </h3>
        <p className={NOTE}>{t("online.training.extra.intro", { today: extra.today })}</p>
      </div>
      <DailyGift />
      <PlayerChooser
        players={club.players}
        chosen={chosen}
        extra={extra}
        disabled={sending}
        onToggle={toggle}
        onAll={() => setChoice({ ...choice, players: null })}
        onNone={() => setChoice({ ...choice, players: [] })}
      />
      <IntensityChooser
        value={intensity}
        costs={extra.costs}
        disabled={sending}
        onChange={setIntensity}
      />
      <SessionsChooser
        choice={choice}
        floor={extra.floor}
        matchToday={matchKickoff !== null}
        disabled={sending}
        onChange={setChoice}
      />
      {starters.length > 0 && (
        <Warning>
          {t("online.training.extra.xiWarning", {
            names: listed(t, starters),
            condition: MATCH_CONDITION,
          })}
        </Warning>
      )}
      {full.length > 0 && (
        <Warning>{t("online.training.extra.focusFull", { names: listed(t, full) })}</Warning>
      )}
      <div className="space-y-2">
        <Button
          type="button"
          disabled={!extra.canPress || sending || offline || chosen.length === 0}
          onClick={() => void press()}
        >
          {choice.sessions === ALL_SESSIONS
            ? t("online.training.extra.pressAll", { players: chosen.length })
            : t("online.training.extra.press", {
                players: chosen.length,
                sessions: choice.sessions,
              })}
        </Button>
        {reason && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {reason}
          </p>
        )}
      </div>
      {result && <PressResult club={club} result={result} />}
    </section>
  );
}

/** Up to three names, then "and k more". */
function listed(t: Translate, players: SquadPlayerView[]): string {
  const { names, more } = namesOf(players);
  return more > 0 ? t("online.training.extra.andMore", { names, more }) : names;
}

/** What a failed press says: the card's own sentence for a refusal, the shared one otherwise. */
function failureText(t: Translate, language: string, error: unknown, now: number): string {
  if (error instanceof OnlineApiError && error.status === 409) {
    return refusalText(t, language, error.code, error.params, now);
  }
  return resolveBackendError(error);
}

function Warning({ children }: { children: string }) {
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-md border border-accent-400/60 bg-accent-50 px-3 py-2 text-sm text-gray-800 dark:border-accent-400/40 dark:bg-accent-500/10 dark:text-gray-100"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
      {children}
    </p>
  );
}

/** The squad with a box each, and why the server would rest a player now (C12-2). */
function PlayerChooser({
  players,
  chosen,
  extra,
  disabled,
  onToggle,
  onAll,
  onNone,
}: {
  players: SquadPlayerView[];
  chosen: string[];
  extra: ExtraDayView;
  disabled: boolean;
  onToggle: (playerId: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  const { t } = useTranslation();
  const ids = new Set(chosen);
  const sitOut = new Map(extra.sitOut.map((line) => [line.playerId, line.reason]));
  return (
    <fieldset className="space-y-2">
      <legend className={LEGEND}>
        {t("online.training.extra.players", { chosen: chosen.length, total: players.length })}
      </legend>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onAll}>
          {t("online.training.extra.selectAll")}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onNone}>
          {t("online.training.extra.selectNone")}
        </Button>
      </div>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {players.map((player) => {
          const why = sitOut.get(player.id);
          return (
            <li
              key={player.id}
              className={`flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 ${why ? "opacity-60" : ""}`}
            >
              <Checkbox
                checked={ids.has(player.id)}
                disabled={disabled}
                aria-label={player.matchName}
                onChange={() => onToggle(player.id)}
              />
              <span className="flex-1">{player.matchName}</span>
              <span className="tabular-nums">
                {t("online.training.extra.condition", { value: Math.round(player.condition) })}
              </span>
              {why && <span className={NOTE}>{t(stopReasonKey(why), { floor: extra.floor })}</span>}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** Low, Medium, High with what a session of each costs; Low by default, the plan unchanged. */
function IntensityChooser({
  value,
  costs,
  disabled,
  onChange,
}: {
  value: string;
  costs: ExtraDayView["costs"];
  disabled: boolean;
  onChange: (intensity: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="space-y-1">
      <legend className={LEGEND}>{t("online.training.extra.intensity")}</legend>
      <div className="flex flex-wrap gap-2">
        {INTENSITY_IDS.map((id) => {
          const cost = costs?.[id];
          return (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={id === value ? "primary" : "outline"}
              aria-pressed={id === value}
              disabled={disabled}
              onClick={() => onChange(id)}
            >
              {cost === undefined
                ? t(`training.intensities.${id}.label`)
                : t("online.training.extra.intensityCost", {
                    intensity: t(`training.intensities.${id}.label`),
                    cost,
                  })}
            </Button>
          );
        })}
      </div>
      <p className={NOTE}>{t("online.training.extra.intensityHint")}</p>
    </fieldset>
  );
}

/** How many sessions, and the condition each player keeps (C12-4). */
function SessionsChooser({
  choice,
  floor,
  matchToday,
  disabled,
  onChange,
}: {
  choice: ExtraChoice;
  floor: number;
  matchToday: boolean;
  disabled: boolean;
  onChange: (choice: ExtraChoice) => void;
}) {
  const { t } = useTranslation();
  const suggested = matchToday ? MATCH_CONDITION : floor;
  return (
    <fieldset className="space-y-2">
      <legend className={LEGEND}>{t("online.training.extra.sessions")}</legend>
      <div className="flex flex-wrap gap-2">
        {SESSION_CHOICES.map((count) => (
          <Button
            key={count}
            type="button"
            size="sm"
            variant={count === choice.sessions ? "primary" : "outline"}
            aria-pressed={count === choice.sessions}
            disabled={disabled}
            onClick={() => onChange({ ...choice, sessions: count })}
          >
            {count === ALL_SESSIONS ? t("online.training.extra.sessionsAll") : String(count)}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <Checkbox
          checked={choice.keepAbove !== null}
          disabled={disabled}
          aria-label={t("online.training.extra.keepAboveOn")}
          onChange={() =>
            onChange({ ...choice, keepAbove: choice.keepAbove === null ? suggested : null })
          }
        />
        <label htmlFor="extra-keep-above">{t("online.training.extra.keepAbove")}</label>
        <input
          id="extra-keep-above"
          type="number"
          min={floor}
          max={100}
          value={choice.keepAbove ?? suggested}
          disabled={disabled || choice.keepAbove === null}
          onChange={(event) => {
            const value = Math.round(Number(event.target.value));
            if (Number.isFinite(value)) {
              onChange({ ...choice, keepAbove: Math.min(100, Math.max(floor, value)) });
            }
          }}
          className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1 tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 dark:border-navy-600 dark:bg-navy-700 dark:focus:ring-offset-navy-800"
        />
      </div>
      {matchToday && (
        <p className={NOTE}>
          {t("online.training.extra.keepAboveHint", { value: MATCH_CONDITION })}
        </p>
      )}
    </fieldset>
  );
}

/** The answer to the press: how many sessions ran, and each chosen player's line (C12-5). */
function PressResult({ club, result }: { club: MyClubView; result: ExtraSessionView }) {
  const { t } = useTranslation();
  const byId = new Map(club.players.map((player) => [player.id, player]));
  return (
    <div className="space-y-2 rounded-md bg-gray-50 p-3 dark:bg-navy-800">
      <p className="text-sm text-gray-800 dark:text-gray-100" role="status">
        {t("online.training.extra.held", {
          held: result.held,
          first: result.firstN,
          last: result.lastN,
        })}
      </p>
      <table className="w-full text-left text-sm text-gray-700 dark:text-gray-200">
        <thead>
          <tr>
            <th className="py-1 font-semibold">{t("online.training.today.player")}</th>
            <th className="py-1 text-right font-semibold">{t("online.training.today.before")}</th>
            <th className="py-1 text-right font-semibold">{t("online.training.today.after")}</th>
            <th className="py-1 text-right font-semibold">
              {t("online.training.extra.sessionsColumn")}
            </th>
            <th className="py-1 text-right font-semibold">{t("online.training.extra.gains")}</th>
          </tr>
        </thead>
        <tbody>
          {result.players.map((line) => (
            <tr key={line.playerId}>
              <td className="py-1">
                {byId.get(line.playerId)?.matchName ?? line.playerId}
                {line.stoppedBy && (
                  <span className={`ml-2 ${NOTE}`}>{t(stopReasonKey(line.stoppedBy))}</span>
                )}
              </td>
              <td className="py-1 text-right tabular-nums">{Math.round(line.conditionBefore)}</td>
              <td className="py-1 text-right tabular-nums">{Math.round(line.conditionAfter)}</td>
              <td className="py-1 text-right tabular-nums">{line.sessions}</td>
              <td className="py-1 text-right tabular-nums">
                {line.gains > 0
                  ? t("online.training.extra.gainsCount", { gains: line.gains })
                  : t("online.training.extra.noGain")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
