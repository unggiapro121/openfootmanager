import { useTranslation } from "react-i18next";
import { Card, CardBody, CardHeader, ProgressBar } from "../../components/ui";
import { resolveBackendError } from "../../utils/backendI18n";
import type { StyleMasteryView } from "../api";
import { online } from "../client";
import { tracked } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";
import StyleEffectChips from "./StyleEffectChips";
import ItemShortcuts from "./items/ItemShortcuts";

/**
 * The coach's command of each play style (his online profile): its level and the XP towards the
 * next point, as the offline manager screen shows them. XP is earned in league matches he directs.
 */
export default function CoachMastery() {
  const { t } = useTranslation();
  const { resource } = useOnlineResource(
    async () => (await tracked(() => online.me.career())).mastery,
    [],
  );

  return (
    <Card className="lg:col-span-3">
      <CardHeader>{t("manager.playStyleMastery")}</CardHeader>
      <CardBody className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <p className="text-gray-500 dark:text-gray-400">{t("online.mastery.hint")}</p>
        {resource.status === "loading" && <p>{t("online.loading")}</p>}
        {resource.status === "failed" && (
          <p role="alert" className="text-red-600 dark:text-red-400">
            {resolveBackendError(resource.error)}
          </p>
        )}
        {resource.status === "ready" && (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {resource.data.map((style) => (
              <StyleTile key={style.style} style={style} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function StyleTile({ style }: { style: StyleMasteryView }) {
  const { t } = useTranslation();
  const atMaximum = style.xpToNext === 0;
  const name = t(`common.playStyles.${style.style}`, style.style);
  return (
    <li
      data-testid={`mastery-${style.style}`}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 dark:border-navy-600 dark:bg-navy-800"
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="truncate text-[15px] font-semibold text-gray-900 dark:text-gray-100">
          {name}
        </h4>
        <p className="flex shrink-0 items-baseline gap-1.5">
          <span className="font-heading text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {t("manager.masteryLevel")}
          </span>
          <span className="font-heading text-2xl font-bold leading-none tabular-nums text-gray-900 dark:text-gray-100">
            {style.level}
          </span>
        </p>
      </div>
      <StyleEffectChips effects={style.effects} />
      <ItemShortcuts
        codes={["tacticalNoteBasic", "tacticalNoteAdvanced", "tacticalNoteMaster"]}
        target={{ kind: "style", style: style.style }}
      />
      <ProgressBar
        value={atMaximum ? 100 : Math.min(100, Math.round((style.xp / style.xpToNext) * 100))}
        variant="primary"
        size="sm"
      />
      <p className="flex justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span
          className={
            style.xp > 0 ? "font-semibold text-primary-700 dark:text-primary-400" : "font-semibold"
          }
        >
          {atMaximum
            ? t("manager.masteryMax")
            : t("manager.masteryXp", { xp: style.xp, next: style.xpToNext })}
        </span>
        <span className="tabular-nums">
          {t("manager.masteryMatches", { count: style.matches })}
        </span>
      </p>
    </li>
  );
}
