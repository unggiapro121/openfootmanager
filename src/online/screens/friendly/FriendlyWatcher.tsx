import { useEffect } from "react";
import { online } from "../../client";
import { watchAccount } from "../../live";
import { refreshFriendly, useOnlineStore } from "../../store/onlineStore";

/**
 * Follows the coach's own account channel for as long as they are in the online mode (S12-22):
 * a ring reads their friendly again, and holding the channel is what keeps them present in the
 * friendly queue, whichever online page they are on. Nothing here is shown: a failure leaves the
 * friendly page to read the friendly itself.
 */
export function FriendlyWatcher() {
  useEffect(() => {
    let live = true;
    let stop: (() => Promise<void>) | undefined;
    const ring = () => void refreshFriendly().catch(() => undefined);
    online.me
      .get()
      .then((account) => {
        if (!live) return undefined;
        useOnlineStore.setState({ accountId: account.id });
        ring();
        return watchAccount(account.id, ring);
      })
      .then((stopWatching) => {
        if (!stopWatching) return;
        if (live) stop = stopWatching;
        else void stopWatching();
      })
      .catch(() => undefined);
    return () => {
      live = false;
      void stop?.();
    };
  }, []);
  return null;
}
