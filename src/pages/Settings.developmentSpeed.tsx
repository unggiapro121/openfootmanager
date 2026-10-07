import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "../components/ui";
import { setDevelopmentSpeed } from "../services/careerSettingsService";
import { useGameStore } from "../store/gameStore";
import { resolveBackendError } from "../utils/backendI18n";
import { SettingRow } from "./Settings.components";

/** The scale the backend accepts, as percentages: 1× to 5× in half steps. */
const SPEED_PERCENTAGES = [100, 150, 200, 250, 300, 350, 400, 450, 500] as const;
const REALISTIC_PERCENT = 100;

/**
 * Settings > Game Engine: how fast players develop in the open career. A per-career rule, so it
 * is read from and written to the loaded game rather than the app's own settings, and cannot be
 * changed from the main menu.
 */
export default function DevelopmentSpeedSetting() {
  const { t, i18n } = useTranslation();
  const gameState = useGameStore((state) => state.gameState);
  const setGameState = useGameStore((state) => state.setGameState);
  const [error, setError] = useState<string | null>(null);

  const careerOpen = gameState !== null;
  const currentPercent = gameState?.development_speed ?? REALISTIC_PERCENT;
  const multiplierFormat = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });

  const labelFor = (percent: number) => {
    const multiplier = `${multiplierFormat.format(percent / 100)}×`;
    return percent === REALISTIC_PERCENT
      ? `${multiplier} (${t("settings.developmentSpeedRealistic")})`
      : multiplier;
  };

  const handleChange = async (percent: number) => {
    setError(null);
    try {
      setGameState(await setDevelopmentSpeed(percent));
    } catch (refusal) {
      setError(resolveBackendError(refusal));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <SettingRow
        label={t("settings.developmentSpeed")}
        description={
          careerOpen ? t("settings.developmentSpeedDesc") : t("settings.developmentSpeedNoCareer")
        }
      >
        <Select
          aria-label={t("settings.developmentSpeed")}
          value={String(currentPercent)}
          disabled={!careerOpen}
          onChange={(event) => void handleChange(Number(event.target.value))}
          className="min-w-48"
        >
          {SPEED_PERCENTAGES.map((percent) => (
            <option key={percent} value={String(percent)}>
              {labelFor(percent)}
            </option>
          ))}
        </Select>
      </SettingRow>
      {error && (
        <p role="alert" className="text-xs text-red-500 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
