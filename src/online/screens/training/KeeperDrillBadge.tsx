import { useTranslation } from "react-i18next";

/**
 * The keepers' drill badge beside a keeper (C-16): he trains handling, reflexes and aerial on top
 * of his focus in every session this season. The title says what the drill is.
 */
export function KeeperDrillBadge() {
  const { t } = useTranslation();
  return (
    <span
      title={t("online.training.main.keeperDrill")}
      className="inline-flex shrink-0 items-center rounded-md bg-accent-100 px-1.5 py-px text-[11px] font-semibold leading-4 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300"
    >
      {t("online.training.keeperBadge")}
    </span>
  );
}
