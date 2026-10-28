import { type ReactNode, useState } from "react";
import { useOnlineStore } from "../../store/onlineStore";
import ItemsToast from "../items/ItemsToast";
import UseItemDialog from "../items/UseItemDialog";

/**
 * How many of `code` the coach holds and may use now: none while the season has no item rules
 * or the items are locked, so the overview offers no use the server would refuse outright.
 */
export function useUsableCount(code: string): number {
  return useOnlineStore((state) => {
    const items = state.items;
    if (!items?.limits || items.locked) return 0;
    return items.lines.find((line) => line.itemCode === code)?.total ?? 0;
  });
}

/**
 * A use of an item started from the overview (C-7 C7-14): the use dialog, which previews it,
 * then what it did in the corner.
 */
export function useItemUse(): { start: (code: string) => void; dialog: ReactNode } {
  const [using, setUsing] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const start = (code: string) => {
    setDone(null);
    setUsing(code);
  };
  const dialog = (
    <>
      {using && (
        <UseItemDialog
          code={using}
          onClose={() => setUsing(null)}
          onDone={(text) => {
            setUsing(null);
            setDone(text);
          }}
        />
      )}
      {done && <ItemsToast text={done} onClose={() => setDone(null)} />}
    </>
  );
  return { start, dialog };
}
