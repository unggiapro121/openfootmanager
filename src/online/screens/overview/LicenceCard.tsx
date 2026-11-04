import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import type { LicenceView } from "../../api";
import { itemName } from "../items/itemText";
import OverviewCard, { CardBadge, CardLink } from "./OverviewCard";
import { useUsableCount } from "./useItemUse";

const BOOSTER = "xpBoosterX2";

/**
 * The coach's licence (design tong-quan.html, S-9 S9-15): the one held at his online level, the
 * next and the level it opens at, and the XP booster held to get there sooner. Nothing while the
 * season has no licences.
 */
export default function LicenceCard({
  licence,
  onUse,
}: {
  licence: LicenceView | undefined;
  onUse: (code: string) => void;
}) {
  const { t } = useTranslation();
  const boosters = useUsableCount(BOOSTER);
  if (!licence) return null;
  const next = licence.nextTierLevel;
  return (
    <OverviewCard
      title={t("online.licence.title")}
      edge="accent"
      className="flex-[1_1_420px]"
      action={
        <span className="flex items-center gap-3">
          {licence.pending && <CardBadge tone="gold">{t("online.licence.pending")}</CardBadge>}
          <CardLink to="/online/profile">{t("online.nav.profile")}</CardLink>
        </span>
      }
    >
      <div className="flex flex-1 flex-col gap-5 p-6 max-md:gap-3 max-md:p-4">
        <ol
          aria-label={t("online.overview.licenceRoad")}
          className="flex flex-wrap items-center gap-3"
        >
          <Step
            tier={licence.tier}
            current
            line={t("online.overview.licenceNow", { level: licence.level })}
          />
          {next !== undefined && (
            <>
              <li
                aria-hidden="true"
                className="h-0 min-w-6 flex-1 border-t-2 border-dashed border-gray-300 dark:border-gray-500"
              />
              <Step
                tier={licence.tier + 1}
                current={false}
                line={t("online.overview.licenceNext", { level: next })}
              />
            </>
          )}
        </ol>
        {next === undefined && (
          <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.licence.highest")}</p>
        )}
        {boosters > 0 && (
          <div className="mt-auto flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 dark:border-navy-600 dark:bg-navy-800">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="flex flex-[1_1_160px] flex-col gap-px">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("online.overview.boosterHeld", { item: itemName(t, BOOSTER), count: boosters })}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("online.overview.boosterHint")}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onUse(BOOSTER)}
              className="inline-flex h-10 items-center rounded-lg bg-accent-400 px-3.5 font-heading text-sm font-bold uppercase tracking-wider text-navy-900 hover:bg-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 dark:bg-accent-400 dark:text-navy-900 dark:hover:bg-accent-500 dark:focus:ring-offset-navy-800"
            >
              {t("online.overview.activate")}
            </button>
          </div>
        )}
      </div>
    </OverviewCard>
  );
}

/** One licence on the road: its number in a disc, its name, and where the coach stands. */
function Step({ tier, current, line }: { tier: number; current: boolean; line: string }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-heading text-lg font-bold ${
          current
            ? "bg-accent-400 text-navy-900 dark:bg-accent-400 dark:text-navy-900"
            : "border-2 border-gray-400 text-gray-500 dark:border-gray-500 dark:text-gray-400"
        }`}
      >
        {tier}
      </span>
      <span className="flex flex-col gap-px">
        <span
          className={`font-heading text-lg font-bold uppercase tracking-wider ${
            current ? "text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-300"
          }`}
        >
          {t(`tactics.licence.tier_${tier}`)}
        </span>
        <span
          className={`text-xs ${current ? "font-semibold text-accent-700 dark:text-accent-300" : "text-gray-500 dark:text-gray-400"}`}
        >
          {line}
        </span>
      </span>
    </li>
  );
}
