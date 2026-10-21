import type { TFunction } from "i18next";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getPlayStyleMastery, NEUTRAL_MASTERY, PLAY_STYLE_IDS } from "../../lib/managerMastery";
import type {
  ManagerData,
  ManagerProgressionView,
  PlayStyleId,
  StyleEffectView,
  StyleProgressView,
} from "../../store/types";
import { Card, CardBody, CardHeader, ProgressBar } from "../ui";

interface PlayStyleMasteryCardProps {
  manager: ManagerData;
  /** The backend's progression view; null until it has loaded. */
  progression: ManagerProgressionView | null;
}

/** The user's mastery of each play style: its level, what it does, and progress to the next point. */
export function PlayStyleMasteryCard({ manager, progression }: PlayStyleMasteryCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="md:col-span-3">
      <section aria-label={t("manager.playStyleMastery")}>
        <CardHeader
          action={
            <p
              data-testid="mastery-neutral-level"
              className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
            >
              <span>{t("manager.masteryNeutralLevel")}</span>
              <span className="font-heading text-base font-bold text-gray-800 dark:text-gray-100">
                {NEUTRAL_MASTERY}
              </span>
            </p>
          }
        >
          {t("manager.playStyleMastery")}
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("manager.playStyleMasteryHint")}
          </p>

          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PLAY_STYLE_IDS.map((style) => (
              <StyleTile
                key={style}
                style={style}
                level={getPlayStyleMastery(manager, style)}
                detail={progression?.styles.find((entry) => entry.style === style)}
                t={t}
              />
            ))}
          </ul>

          {progression && (
            <p className="flex items-start gap-2.5 rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-600 dark:bg-navy-800 dark:text-gray-300">
              <Info
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
              />
              <span>
                {t("manager.masteryEarnedHint", {
                  win: progression.xp_for_a_win,
                  draw: progression.xp_for_a_draw,
                  loss: progression.xp_for_a_loss,
                })}
              </span>
            </p>
          )}
        </CardBody>
      </section>
    </Card>
  );
}

interface StyleTileProps {
  style: PlayStyleId;
  level: number;
  detail: StyleProgressView | undefined;
  t: TFunction;
}

function StyleTile({ style, level, detail, t }: StyleTileProps) {
  const styleName = t(`common.playStyles.${style}`, style);
  return (
    <li
      data-testid={`mastery-${style}`}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 dark:border-navy-600 dark:bg-navy-800"
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="truncate text-[15px] font-semibold text-gray-900 dark:text-gray-100">
          {styleName}
        </h4>
        <p className="flex shrink-0 items-baseline gap-1.5">
          <span className="font-heading text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {t("manager.masteryLevel")}
          </span>
          <span
            data-testid={`mastery-level-${style}`}
            className="font-heading text-2xl font-bold leading-none tabular-nums text-gray-900 dark:text-gray-100"
          >
            {level}
          </span>
        </p>
      </div>

      {detail && (
        <>
          <StyleEffects effects={detail.effects} t={t} />
          <StyleProgress detail={detail} styleName={styleName} t={t} />
        </>
      )}
    </li>
  );
}

function StyleEffects({ effects, t }: { effects: StyleEffectView[]; t: TFunction }) {
  const { i18n } = useTranslation();
  // The backend sends two decimals so every point of mastery shows; keep them.
  const percentFormat = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  const chip =
    "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-semibold";
  if (effects.length === 0) {
    return (
      <div className="flex min-h-6 flex-wrap gap-1.5">
        <span className={`${chip} bg-gray-100 text-gray-600 dark:bg-navy-600 dark:text-gray-300`}>
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
            className={`${chip} ${
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

function StyleProgress({
  detail,
  styleName,
  t,
}: {
  detail: StyleProgressView;
  styleName: string;
  t: TFunction;
}) {
  const atMaximum = detail.xp_to_next === null;
  const progressMax = detail.xp_to_next ?? 1;
  const progressNow = atMaximum ? progressMax : Math.min(detail.xp, progressMax);
  const percent = Math.round((progressNow / progressMax) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{t("manager.masteryProgress")}</span>
        <span className="tabular-nums">
          <span
            className={
              detail.xp > 0
                ? "font-semibold text-primary-700 dark:text-primary-400"
                : "font-semibold"
            }
          >
            {atMaximum
              ? t("manager.masteryMax")
              : t("manager.masteryXp", { xp: detail.xp, next: detail.xp_to_next })}
          </span>
          {" · "}
          {t("manager.masteryMatches", { count: detail.matches })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${styleName} · ${t("manager.masteryProgress")}`}
        aria-valuemin={0}
        aria-valuemax={progressMax}
        aria-valuenow={progressNow}
      >
        <ProgressBar value={percent} variant="primary" size="sm" />
      </div>
    </div>
  );
}
