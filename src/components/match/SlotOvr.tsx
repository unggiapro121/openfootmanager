import { useTranslation } from "react-i18next";
import { convertsToWingBackAt, fitToneClass, ratingAt } from "./slotRatings";
import type { EnginePlayerData } from "./types";

/**
 * A player's overall in `slot`, coloured by how familiar it is to him; his
 * plain overall when there is no slot or the backend did not rate him there.
 */
export function SlotOvr({ player, slot }: { player: EnginePlayerData; slot?: string }) {
  const { t } = useTranslation();
  const rating = slot ? ratingAt(player, slot) : undefined;
  if (!rating) {
    return <span className="text-gray-500 dark:text-gray-400">{player.ovr}</span>;
  }
  const note =
    slot && convertsToWingBackAt(player, slot) ? t("match.wingBackConversion") : undefined;
  return (
    <span className={fitToneClass(rating.fit)} title={note}>
      {rating.ovr}
    </span>
  );
}
