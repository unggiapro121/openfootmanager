import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { refreshItems, useOnlineStore } from "../store/onlineStore";
import { itemName } from "./items/itemText";

/** The card a rename spends (S-14): one for a player, one for the club. */
export type RenameCard = "playerRename" | "clubRename";

/**
 * Whether a rename needs a card the coach does not have, so the dialog holds its save (C-7 C7-15):
 * not for the first rename, and not while the inventory is unread or the server is older.
 */
export function useRenameCard(
  card: RenameCard,
  free: boolean | undefined,
): { held: number | undefined; blocked: boolean } {
  const items = useOnlineStore((state) => state.items);
  // A free rename spends nothing: the inventory is read only when a card may be needed.
  useEffect(() => {
    if (free !== true) void refreshItems().catch(() => undefined);
  }, [free]);
  const held = items ? (items.lines.find((line) => line.itemCode === card)?.total ?? 0) : undefined;
  const blocked =
    free === false && items !== undefined && items !== null && (items.locked || held === 0);
  return { held, blocked };
}

/**
 * The line under a rename's name field (C-7 C7-15, §17.5): free the first time; else the card it
 * spends and how many are held, the inventory's lock, or a link to buy one. An older server sends
 * no `renameFree`: only the cards held are said, and a refusal still names the card.
 */
export default function RenameCardNote({
  card,
  free,
}: {
  card: RenameCard;
  free: boolean | undefined;
}) {
  const { t } = useTranslation();
  const items = useOnlineStore((state) => state.items);
  // The dialog's `useRenameCard` reads the inventory; the note only shows it.
  const held = items ? (items.lines.find((line) => line.itemCode === card)?.total ?? 0) : undefined;
  const name = itemName(t, card);
  let text: string | null;
  let buy = false;
  if (free === true) text = t("online.rename.free");
  else if (held === undefined) text = null;
  else if (free === undefined) text = t("online.rename.held", { item: name, count: held });
  else if (items?.locked) text = t("online.rename.itemsLocked");
  else if (held > 0) text = t("online.rename.willSpend", { item: name, count: held });
  else {
    text = t("online.rename.needCard", { item: name });
    buy = true;
  }
  if (text === null) return null;
  return (
    <p role="note" className="text-xs text-gray-600 dark:text-gray-300">
      {text}
      {buy && (
        <>
          {" "}
          <Link to={`/online/shop?item=${card}`} className="font-semibold underline">
            {t("online.rename.toShop")}
          </Link>
        </>
      )}
    </p>
  );
}
