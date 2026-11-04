import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { INTENSITY_IDS } from "../../../components/training/trainingOptions";
import type { ExtraDayView } from "../../api";
import { FOCUS } from "../mobile/PhoneSheet";
import { ALL_SESSIONS, type ExtraChoice, MATCH_CONDITION, SESSION_CHOICES } from "./extraText";

const KEY = "online.training.phone";
/** How far one press of − or + moves the condition to keep. */
const KEEP_STEP = 5;

const LABEL =
  "whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400";
const TRACK =
  "grid rounded-[10px] border border-gray-200 bg-gray-50 p-[3px] dark:border-navy-600 dark:bg-navy-900";
const segment = (on: boolean) =>
  `rounded-lg disabled:opacity-50 ${on ? "bg-white text-gray-900 shadow-sm dark:bg-navy-600 dark:text-white" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`;

/**
 * The extra session's settings (design MTapThem "Thiết lập buổi tập thêm"), one row
 * each: the intensity with what a session costs, how many sessions, and the condition to keep,
 * which the − and + also switch on.
 */
export function ExtraSettings({
  intensity,
  costs,
  choice,
  floor,
  matchToday,
  disabled,
  onIntensity,
  onChoice,
}: {
  intensity: string;
  costs: ExtraDayView["costs"];
  choice: ExtraChoice;
  floor: number;
  matchToday: boolean;
  disabled: boolean;
  onIntensity: (intensity: string) => void;
  onChoice: (choice: ExtraChoice) => void;
}) {
  const { t } = useTranslation();
  const keeping = choice.keepAbove !== null;
  const value = choice.keepAbove ?? (matchToday ? MATCH_CONDITION : floor);
  const keep = (next: number) =>
    onChoice({ ...choice, keepAbove: Math.min(100, Math.max(floor, Math.round(next))) });
  return (
    <section
      aria-label={t(`${KEY}.settings`)}
      className="grid grid-cols-[66px_minmax(0,1fr)] items-center gap-2.5 rounded-[14px] border border-gray-200 bg-white px-3.5 py-3 dark:border-navy-600 dark:bg-navy-700"
    >
      <span className={LABEL}>{t("online.training.extra.intensity")}</span>
      <div
        role="radiogroup"
        aria-label={t("online.training.extra.intensity")}
        className={`${TRACK} grid-cols-3`}
      >
        {INTENSITY_IDS.map((id) => {
          const cost = costs?.[id];
          const on = id === intensity;
          const label = t(`training.intensities.${id}.label`);
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={
                cost === undefined
                  ? label
                  : t("online.training.extra.intensityCost", { intensity: label, cost })
              }
              disabled={disabled}
              onClick={() => onIntensity(id)}
              className={`flex h-10 flex-col items-center justify-center leading-tight ${segment(on)}`}
            >
              <span className="text-[13px] font-bold">{label}</span>
              {cost !== undefined && (
                <span
                  className={`text-[10px] ${on ? "text-red-600 dark:text-red-300" : "text-gray-500 dark:text-gray-400"}`}
                >
                  {t(`${KEY}.costShort`, { cost })}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <span className={LABEL}>{t("online.training.extra.sessions")}</span>
      <div
        role="radiogroup"
        aria-label={t("online.training.extra.sessions")}
        className={`${TRACK} grid-cols-[1fr_1fr_1fr_1.6fr]`}
      >
        {SESSION_CHOICES.map((count) => (
          <button
            key={count}
            type="button"
            role="radio"
            aria-checked={count === choice.sessions}
            disabled={disabled}
            onClick={() => onChoice({ ...choice, sessions: count })}
            className={`h-9 text-[13px] font-bold ${segment(count === choice.sessions)}`}
          >
            {count === ALL_SESSIONS ? t(`${KEY}.sessionsMax`) : String(count)}
          </button>
        ))}
      </div>

      <span className={LABEL}>{t(`${KEY}.keepShort`)}</span>
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={keeping}
          aria-label={t("online.training.extra.keepAboveOn")}
          disabled={disabled}
          onClick={() => onChoice({ ...choice, keepAbove: keeping ? null : value })}
          className={`flex h-6.5 w-11 shrink-0 rounded-full p-0.5 disabled:opacity-50 ${keeping ? "justify-end bg-primary-500" : "justify-start bg-gray-300 dark:bg-gray-600"} ${FOCUS}`}
        >
          <span className="h-5.5 w-5.5 rounded-full bg-white shadow" />
        </button>
        <span
          className={`inline-flex items-center overflow-hidden rounded-lg border border-gray-300 dark:border-navy-600 ${keeping ? "" : "opacity-45"}`}
        >
          <button
            type="button"
            aria-label={t("online.training.extra.keepLess")}
            disabled={disabled}
            onClick={() => keep(value - KEEP_STEP)}
            className={`flex h-8 w-8 items-center justify-center text-gray-800 disabled:opacity-50 dark:text-white ${FOCUS}`}
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <output
            aria-label={t("online.training.extra.keepAbove")}
            className="min-w-7 text-center text-sm font-bold tabular-nums text-gray-900 dark:text-white"
          >
            {value}
          </output>
          <button
            type="button"
            aria-label={t("online.training.extra.keepMore")}
            disabled={disabled}
            onClick={() => keep(value + KEEP_STEP)}
            className={`flex h-8 w-8 items-center justify-center text-gray-800 disabled:opacity-50 dark:text-white ${FOCUS}`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => keep(MATCH_CONDITION)}
          className={`h-8 whitespace-nowrap px-1.5 text-xs font-semibold text-primary-700 disabled:opacity-50 dark:text-primary-400 ${FOCUS}`}
        >
          {t(`${KEY}.keepMatchShort`, { value: MATCH_CONDITION })}
        </button>
      </div>
    </section>
  );
}
