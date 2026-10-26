import { useTranslation } from "react-i18next";
import type { StyleEffectView } from "../api";

const CHIP =
  "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-semibold";

/**
 * What a play style does at the coach's mastery, a chip a phase (▲ strengthens, ▼ costs), as the
 * offline manager screen shows it. A style that changes no phase says it plays as designed.
 */
export default function StyleEffectChips({ effects }: { effects: StyleEffectView[] }) {
  const { t, i18n } = useTranslation();
  // The server sends two decimals so every point of mastery shows; keep them.
  const percentFormat = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  if (effects.length === 0) {
    return (
      <div className="flex min-h-6 flex-wrap gap-1.5">
        <span className={`${CHIP} bg-gray-100 text-gray-600 dark:bg-navy-600 dark:text-gray-300`}>
          {t("manager.masteryNeutralStyle")}
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-h-6 flex-wrap gap-1.5">
      {effects.map((effect) => {
        const strengthens = effect.percent > 0;
        return (
          <span
            key={effect.phase}
            className={`${CHIP} ${
              strengthens
                ? "bg-primary-500/10 text-primary-700 dark:bg-primary-400/10 dark:text-primary-400"
                : "bg-red-500/10 text-red-700 dark:bg-red-400/10 dark:text-red-400"
            }`}
          >
            <span className="tabular-nums">
              {`${strengthens ? "▲" : "▼"} ${percentFormat.format(Math.abs(effect.percent))}%`}
            </span>
            <span className="font-medium">{t(`manager.stylePhase.${effect.phase}`)}</span>
          </span>
        );
      })}
    </div>
  );
}
