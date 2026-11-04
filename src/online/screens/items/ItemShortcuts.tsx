import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui";
import type { ItemTarget } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import { itemName } from "./itemText";
import UseItemDialog from "./UseItemDialog";

/**
 * A use of an item started where its target is (C-7 C7-14): a player's page, the squad's head, a
 * style's tile. Only the items held and usable this season show (`limits` absent: the season has
 * no item rules); the dialog's preview says the rest.
 */
export default function ItemShortcuts({ codes, target }: { codes: string[]; target: ItemTarget }) {
  const { t } = useTranslation();
  const items = useOnlineStore((state) => state.items);
  const [using, setUsing] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!items?.limits || items.locked) return null;
  // A season that allows no use of the team pack a day has it off all season: no shortcut.
  const teamPackOff = items.limits.teamRecovery?.perDay === 0;
  const held = codes
    .filter((code) => !(code === "teamRecoveryPack" && teamPackOff))
    .map((code) => ({
      code,
      total: items.lines.find((line) => line.itemCode === code)?.total ?? 0,
    }))
    .filter((entry) => entry.total > 0);
  if (held.length === 0 && done === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {held.map(({ code, total }) => (
        <Button
          key={code}
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setDone(null);
            setUsing(code);
          }}
        >
          {t("online.items.shortcut", { item: itemName(t, code), count: total })}
        </Button>
      ))}
      {done && (
        <p role="status" className="text-xs text-green-700 dark:text-green-400">
          {done}
        </p>
      )}
      {using && (
        <UseItemDialog
          code={using}
          initialTarget={target}
          lockTarget
          onClose={() => setUsing(null)}
          onDone={(text) => {
            setUsing(null);
            setDone(text);
          }}
        />
      )}
    </div>
  );
}
