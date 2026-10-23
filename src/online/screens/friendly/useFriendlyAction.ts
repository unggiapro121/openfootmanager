import { useState } from "react";
import type { FriendlyMineView } from "../../api";
import { refreshFriendly, tracked, useOnlineStore } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";

/**
 * One friendly action of the coach (S-12): sent with its idempotency key, its answer (the friendly
 * as it stands after it) put in the store. A refusal is kept to show, and the friendly read again,
 * since a refusal often means it changed (another coach left, the room closed).
 */
export function useFriendlyAction() {
  const key = useActionKey();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const act = async (
    send: (idempotencyKey: string) => Promise<FriendlyMineView>,
    action: string,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const friendly = await key.run(
        (idempotencyKey) => tracked(() => send(idempotencyKey)),
        action,
      );
      useOnlineStore.getState().setFriendly(friendly);
      return true;
    } catch (failure) {
      setError(failure);
      void refreshFriendly().catch(() => undefined);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { act, busy, error };
}
