import { fitToneClass, ratingAt } from "./slotRatings";
import type { EnginePlayerData } from "./types";

/**
 * A player's overall in `slot`, coloured by how familiar it is to him; his
 * plain overall when there is no slot or the backend did not rate him there.
 */
export function SlotOvr({ player, slot }: { player: EnginePlayerData; slot?: string }) {
  const rating = slot ? ratingAt(player, slot) : undefined;
  if (!rating) {
    return <span className="text-gray-500 dark:text-gray-400">{player.ovr}</span>;
  }
  return <span className={fitToneClass(rating.fit)}>{rating.ovr}</span>;
}
