import { useTranslation } from "react-i18next";

import {
  formatDevelopmentSpeed,
  REALISTIC_DEVELOPMENT_SPEED_PERCENT,
} from "../lib/developmentSpeed";
import { useGameStore } from "../store/gameStore";
import { SettingRow } from "./Settings.components";

/**
 * Settings > Game Engine: how fast players develop in the open career. Chosen
 * when the career is created and fixed with the world, so this only shows it.
 */
export default function DevelopmentSpeedSetting() {
  const { t, i18n } = useTranslation();
  const gameState = useGameStore((state) => state.gameState);

  const careerOpen = gameState !== null;
  const currentPercent = gameState?.development_speed ?? REALISTIC_DEVELOPMENT_SPEED_PERCENT;

  return (
    <SettingRow
      label={t("settings.developmentSpeed")}
      description={
        careerOpen ? t("settings.developmentSpeedDesc") : t("settings.developmentSpeedNoCareer")
      }
    >
      <span className="font-heading font-bold text-lg tabular-nums text-gray-900 dark:text-gray-100">
        {careerOpen ? formatDevelopmentSpeed(currentPercent, t, i18n.language) : "—"}
      </span>
    </SettingRow>
  );
}
