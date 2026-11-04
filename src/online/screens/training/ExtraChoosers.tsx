import { useTranslation } from "react-i18next";
import { Check, Minus, Plus } from "lucide-react";
import { INTENSITY_IDS } from "../../../components/training/trainingOptions";
import { condBgColor, condColor } from "../../../lib/playerConditionDisplay";
import type { ExtraDayView, ExtraSessionView, MyClubView, SquadPlayerView } from "../../api";
import {
  ALL_SESSIONS,
  type ExtraChoice,
  MATCH_CONDITION,
  SESSION_CHOICES,
  stopReasonKey,
} from "./extraText";
import { extraOrder, stopsBeforeFirst } from "./trainingView";
import { optionClass } from "./WeeklyPlan";

const NOTE = "text-xs text-gray-500 dark:text-gray-400";
const STEP_TITLE =
  "font-heading text-[15px] font-bold uppercase tracking-wider text-gray-900 dark:text-white";
const SMALL_GHOST =
  "h-7.5 rounded-md border border-gray-300 px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 dark:border-navy-600 dark:text-gray-200 dark:hover:bg-navy-600";
/** How far one press of − or + moves the condition to keep. */
const KEEP_STEP = 5;

/** A step of the panel: its number and title, then its body. */
function Step({
  n,
  title,
  children,
}: {
  /** The step's place in the panel; a page that orders them its own way leaves it out. */
  n?: number;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className={`${STEP_TITLE} mb-2`}>
        {n === undefined ? (
          title
        ) : (
          <>
            {n} · {title}
          </>
        )}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Step 1, the players (C12-2): the squad with a box each, those who can train first; why the
 * server would rest one now, and who the condition to keep would stop before a session.
 */
export function PlayerChooser({
  players,
  chosen,
  extra,
  cost,
  keepAbove,
  disabled,
  onToggle,
  onAll,
  onNone,
}: {
  players: SquadPlayerView[];
  chosen: string[];
  extra: ExtraDayView;
  /** What one session costs at the chosen intensity, if the server said. */
  cost: number | undefined;
  keepAbove: number | null;
  disabled: boolean;
  onToggle: (playerId: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  const { t } = useTranslation();
  const ids = new Set(chosen);
  const sitOut = new Map(extra.sitOut.map((line) => [line.playerId, line.reason]));
  return (
    <Step
      n={1}
      title={
        <>
          {t("online.training.extra.playersTitle")}{" "}
          <span className="font-semibold text-gray-500 dark:text-gray-400">
            ({chosen.length}/{players.length})
          </span>
        </>
      }
    >
      <div className="flex flex-wrap justify-end gap-1.5">
        <button type="button" disabled={disabled} onClick={onAll} className={SMALL_GHOST}>
          {t("online.training.extra.selectAll")}
        </button>
        <button type="button" disabled={disabled} onClick={onNone} className={SMALL_GHOST}>
          {t("online.training.extra.selectNone")}
        </button>
      </div>
      <ul className="overflow-hidden rounded-xl border border-gray-200 dark:border-navy-600">
        {extraOrder(players, extra).map((player) => {
          const on = ids.has(player.id);
          const why = sitOut.get(player.id);
          const stops =
            on && !why && stopsBeforeFirst(player.condition, cost, extra.floor, keepAbove);
          const condition = Math.round(player.condition);
          return (
            <li
              key={player.id}
              className="border-b border-gray-200 last:border-b-0 dark:border-navy-600"
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={player.matchName}
                disabled={disabled}
                onClick={() => onToggle(player.id)}
                className={`grid w-full grid-cols-[22px_minmax(0,1fr)_96px_44px] items-center gap-2.5 px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 disabled:opacity-50 ${
                  on ? "bg-primary-50 dark:bg-primary-900/20" : "bg-white dark:bg-navy-700"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4.5 w-4.5 items-center justify-center rounded border-2 ${
                    on
                      ? "border-primary-500 bg-primary-500 text-white dark:text-navy-900"
                      : "border-gray-400 dark:border-gray-500"
                  }`}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={`truncate text-sm font-semibold ${
                      why ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-white"
                    }`}
                  >
                    {player.matchName}
                  </span>
                  {why && (
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                      {t(stopReasonKey(why), { floor: extra.floor })}
                    </span>
                  )}
                  {stops && (
                    <span className="text-[11px] text-accent-700 dark:text-accent-300">
                      {t("online.training.extra.willStop")}
                    </span>
                  )}
                </span>
                <span
                  aria-hidden="true"
                  className={`h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600 ${why ? "opacity-45" : ""}`}
                >
                  <span
                    className={`block h-full ${condBgColor(condition)}`}
                    style={{ width: `${Math.min(100, Math.max(0, condition))}%` }}
                  />
                </span>
                <span
                  className={`text-right text-[13px] font-bold tabular-nums ${condColor(condition)} ${why ? "opacity-45" : ""}`}
                >
                  {condition}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Step>
  );
}

/** Step 2, the intensity: Low, Medium, High with what a session of each costs (C12-3). */
export function IntensityChooser({
  value,
  costs,
  disabled,
  onChange,
  numbered = true,
}: {
  numbered?: boolean;
  value: string;
  costs: ExtraDayView["costs"];
  disabled: boolean;
  onChange: (intensity: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Step n={numbered ? 2 : undefined} title={t("online.training.extra.intensity")}>
      <div
        role="radiogroup"
        aria-label={t("online.training.extra.intensity")}
        className="grid grid-cols-3 gap-1.5"
      >
        {INTENSITY_IDS.map((id) => {
          const cost = costs?.[id];
          const label = t(`training.intensities.${id}.label`);
          const selected = id === value;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={
                cost === undefined
                  ? label
                  : t("online.training.extra.intensityCost", { intensity: label, cost })
              }
              disabled={disabled}
              onClick={() => onChange(id)}
              className={`flex flex-col items-center gap-0.5 px-1.5 py-2 ${optionClass(selected)}`}
            >
              <span
                className={`font-heading text-sm font-bold uppercase tracking-wider ${
                  selected
                    ? "text-primary-700 dark:text-primary-300"
                    : "text-gray-800 dark:text-gray-200"
                }`}
              >
                {label}
              </span>
              {cost !== undefined && (
                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                  {t("online.training.extra.costPer", { cost })}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className={NOTE}>{t("online.training.extra.intensityHint")}</p>
    </Step>
  );
}

/** Step 3, how many sessions, and the condition each player keeps (C12-4). */
export function SessionsChooser({
  choice,
  floor,
  matchToday,
  disabled,
  onChange,
  numbered = true,
}: {
  numbered?: boolean;
  choice: ExtraChoice;
  floor: number;
  matchToday: boolean;
  disabled: boolean;
  onChange: (choice: ExtraChoice) => void;
}) {
  const { t } = useTranslation();
  const suggested = matchToday ? MATCH_CONDITION : floor;
  const keeping = choice.keepAbove !== null;
  const value = choice.keepAbove ?? suggested;
  const keep = (next: number) =>
    onChange({ ...choice, keepAbove: Math.min(100, Math.max(floor, Math.round(next))) });
  return (
    <Step n={numbered ? 3 : undefined} title={t("online.training.extra.sessions")}>
      <div
        role="radiogroup"
        aria-label={t("online.training.extra.sessions")}
        className="flex flex-wrap gap-1.5"
      >
        {SESSION_CHOICES.map((count) => (
          <button
            key={count}
            type="button"
            role="radio"
            aria-checked={count === choice.sessions}
            disabled={disabled}
            onClick={() => onChange({ ...choice, sessions: count })}
            className={`h-9 min-w-11 px-3 text-[13px] font-semibold ${optionClass(count === choice.sessions)} ${
              count === choice.sessions
                ? "text-primary-700 dark:text-primary-300"
                : "text-gray-800 dark:text-gray-200"
            }`}
          >
            {count === ALL_SESSIONS ? t("online.training.extra.sessionsAll") : String(count)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-navy-600 dark:bg-navy-900">
        <button
          type="button"
          role="switch"
          aria-checked={keeping}
          aria-label={t("online.training.extra.keepAboveOn")}
          disabled={disabled}
          onClick={() => onChange({ ...choice, keepAbove: keeping ? null : suggested })}
          className={`flex h-6 w-10 shrink-0 rounded-full p-0.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-navy-800 ${
            keeping ? "justify-end bg-primary-500" : "justify-start bg-gray-300 dark:bg-gray-600"
          }`}
        >
          <span className="h-5 w-5 rounded-full bg-white shadow" />
        </button>
        <label htmlFor="extra-keep-above" className="text-[13px] text-gray-700 dark:text-gray-300">
          {t("online.training.extra.keepAbove")}
        </label>
        <span
          className={`inline-flex items-center overflow-hidden rounded-md border border-gray-300 dark:border-navy-600 ${keeping ? "" : "opacity-40"}`}
        >
          <button
            type="button"
            aria-label={t("online.training.extra.keepLess")}
            disabled={disabled || !keeping}
            onClick={() => keep(value - KEEP_STEP)}
            className="flex h-7.5 w-7.5 items-center justify-center text-gray-800 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:text-white dark:hover:bg-navy-600"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <input
            id="extra-keep-above"
            type="number"
            min={floor}
            max={100}
            value={value}
            disabled={disabled || !keeping}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) keep(next);
            }}
            className="h-7.5 w-11 bg-transparent text-center text-sm font-bold tabular-nums text-gray-900 [appearance:textfield] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 dark:text-white [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            type="button"
            aria-label={t("online.training.extra.keepMore")}
            disabled={disabled || !keeping}
            onClick={() => keep(value + KEEP_STEP)}
            className="flex h-7.5 w-7.5 items-center justify-center text-gray-800 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:text-white dark:hover:bg-navy-600"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...choice, keepAbove: MATCH_CONDITION })}
          className="text-xs font-semibold text-primary-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 dark:text-primary-400"
        >
          {t("online.training.extra.keepMatch", { value: MATCH_CONDITION })}
        </button>
      </div>
    </Step>
  );
}

/** The answer to the press: how many sessions ran, and each chosen player's line (C12-5). */
export function PressResult({ club, result }: { club: MyClubView; result: ExtraSessionView }) {
  const { t } = useTranslation();
  const byId = new Map(club.players.map((player) => [player.id, player]));
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-primary-500/40 bg-primary-50 p-3 dark:bg-primary-900/20">
      <p className="text-sm font-semibold text-gray-900 dark:text-white" role="status">
        {t("online.training.extra.held", {
          held: result.held,
          first: result.firstN,
          last: result.lastN,
        })}
      </p>
      <table className="w-full text-left text-[13px] text-gray-700 dark:text-gray-200">
        <thead className={NOTE}>
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
