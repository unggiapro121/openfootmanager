import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { buildPitchRows } from "../../../components/squad/SquadTab.helpers";
import {
  licenceLock,
  lockHint,
  type TacticsLimits,
} from "../../../components/tactics/licenceLimits";
import { FORMATIONS, getSlotXCoordinates } from "../../../components/tactics/TacticsTab.helpers";
import type { StyleMasteryView } from "../../api";
import { FOCUS } from "../mobile/PhoneSheet";
import { KEY } from "./PhoneTacticsLineup";

const PLAY_STYLES = ["Balanced", "Attacking", "Defensive", "Possession", "Counter", "HighPress"];
const PICKED = "border-primary-500 bg-primary-50 dark:bg-primary-900/35";
const IDLE = "border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800";
const HEADING =
  "font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white";

function masteryTone(level: number): { text: string; bar: string } {
  if (level >= 60) return { text: "text-primary-600 dark:text-primary-400", bar: "bg-primary-500" };
  if (level >= 40) return { text: "text-accent-700 dark:text-accent-400", bar: "bg-accent-400" };
  return { text: "text-red-600 dark:text-red-400", bar: "bg-red-500" };
}

/** A shape drawn small and upright, the goal at the bottom: one dot a slot. */
function ShapeThumb({ formation, picked }: { formation: string; picked: boolean }) {
  const dots = buildPitchRows(formation).flatMap((row) => {
    const depth = Number.parseFloat(row.y);
    return getSlotXCoordinates(row.positions.length).map((across) => ({
      x: 2 + (across / 100) * 36,
      y: 3 + (depth / 100) * 46,
    }));
  });
  return (
    <svg
      viewBox="0 0 40 52"
      className="block h-16 w-auto rounded bg-primary-700"
      aria-hidden="true"
    >
      <path d="M0 26H40" className="stroke-white/25" strokeWidth="0.6" />
      {dots.map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r="2.4"
          className={picked ? "fill-primary-200" : "fill-gray-200"}
        />
      ))}
    </svg>
  );
}

/**
 * The style tab (design m-chien-thuat): the shapes as small pitches, then the play styles, each
 * with what it does at the coach's mastery and the mastery itself. A shape or style the licence
 * keeps closed says the level that opens it.
 */
export function PhoneTacticsStyle({
  formation,
  playStyle,
  mastery,
  limits,
  locked,
  onFormation,
  onPlayStyle,
}: {
  formation: string;
  playStyle: string;
  mastery: StyleMasteryView[] | null;
  limits?: TacticsLimits;
  locked: boolean;
  onFormation: (formation: string) => void;
  onPlayStyle: (style: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const percent = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="phone-shape-title" className="flex flex-col gap-2">
        <h2 id="phone-shape-title" className={HEADING}>
          {t("tactics.formation")}
        </h2>
        <div
          role="radiogroup"
          aria-labelledby="phone-shape-title"
          className="grid grid-cols-3 gap-2"
        >
          {FORMATIONS.map((value) => {
            const on = value === formation;
            const lock = licenceLock(limits, { kind: "formation", value });
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked || lock !== null}
                onClick={() => onFormation(value)}
                className={`flex flex-col items-center gap-1 rounded-[10px] border p-1.5 disabled:opacity-50 ${on ? PICKED : IDLE} ${FOCUS}`}
              >
                <ShapeThumb formation={value} picked={on} />
                <span className="font-heading text-[15px] font-bold text-gray-900 dark:text-white">
                  {value}
                </span>
                {lock && (
                  <span className="flex items-center gap-0.5 text-[10px] text-accent-700 dark:text-accent-400">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    {t(`${KEY}.level`, { level: lock.level })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>
      <section aria-labelledby="phone-style-title" className="flex flex-col gap-2">
        <h2 id="phone-style-title" className={HEADING}>
          {t("tactics.playStyle")}{" "}
          <span className="font-sans text-[11px] font-normal normal-case tracking-normal text-gray-500 dark:text-gray-400">
            {t(`${KEY}.masteryNote`)}
          </span>
        </h2>
        <div
          role="radiogroup"
          aria-labelledby="phone-style-title"
          className="flex flex-col gap-1.5"
        >
          {PLAY_STYLES.map((style) => {
            const on = style === playStyle;
            const lock = licenceLock(limits, { kind: "playStyle", value: style });
            const entry = mastery?.find((one) => one.style === style);
            const tone = entry ? masteryTone(entry.level) : null;
            return (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked || lock !== null}
                onClick={() => onPlayStyle(style)}
                className={`grid min-h-[52px] grid-cols-[minmax(0,1fr)_84px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left disabled:opacity-50 ${on ? PICKED : IDLE} ${FOCUS}`}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span
                    className={`text-[15px] font-bold ${on ? "text-primary-700 dark:text-primary-300" : "text-gray-900 dark:text-white"}`}
                  >
                    {t(`common.playStyles.${style}`)}
                  </span>
                  <span className="flex flex-wrap gap-x-1.5 text-[11px] font-semibold">
                    {entry?.effects.map((effect) => (
                      <span
                        key={effect.phase}
                        className={
                          effect.percent > 0
                            ? "text-primary-600 dark:text-primary-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {`${effect.percent > 0 ? "▲" : "▼"} ${percent.format(Math.abs(effect.percent))}% `}
                        {t(`manager.stylePhase.${effect.phase}`)}
                      </span>
                    ))}
                    {lock && (
                      <span className="text-accent-700 dark:text-accent-400">
                        {lockHint(t, lock)}
                      </span>
                    )}
                  </span>
                </span>
                {entry && tone && (
                  <span className="flex flex-col items-end gap-1">
                    <span className={`font-heading text-lg font-bold ${tone.text}`}>
                      {entry.level}
                    </span>
                    <span
                      className="h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700"
                      aria-hidden="true"
                    >
                      <span
                        className={`block h-full ${tone.bar}`}
                        style={{ width: `${entry.level}%` }}
                      />
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t("tactics.masteryEarnedHint")}</p>
      </section>
    </div>
  );
}
