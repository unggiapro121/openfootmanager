import { useState } from "react";
import type { ItemTarget, ItemUseView } from "../../api";
import { online } from "../../client";
import { refreshClub, refreshItems, tracked, useOnlineStore } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";

/**
 * One use of an item as every screen sends it (C-7 C7-14; C-17 C17-1): under an idempotency key
 * kept while the same use has no answer, the stacks the server says are left put in the store at
 * once, then the items and, for a use on players, the club read again. A refusal rejects with the
 * server's error, for the caller to show.
 */
export function useApplyItem(): {
  apply: (code: string, target: ItemTarget) => Promise<ItemUseView>;
  busy: boolean;
} {
  const { run } = useActionKey();
  const [busy, setBusy] = useState(false);

  const apply = async (code: string, target: ItemTarget): Promise<ItemUseView> => {
    setBusy(true);
    try {
      const view = await run(
        (key) => tracked(() => online.items.use(code, target, key)),
        `${code}:${JSON.stringify(target)}`,
      );
      useOnlineStore.setState((state) => ({
        items: state.items
          ? {
              ...state.items,
              lines: state.items.lines.map((line) =>
                line.itemCode === code
                  ? {
                      ...line,
                      stacks: view.held,
                      total: view.held.reduce((sum, stack) => sum + stack.quantity, 0),
                    }
                  : line,
              ),
            }
          : state.items,
      }));
      void refreshItems().catch(() => undefined);
      if (target.kind === "player" || target.kind === "club") {
        void refreshClub().catch(() => undefined);
      }
      return view;
    } finally {
      setBusy(false);
    }
  };

  return { apply, busy };
}
