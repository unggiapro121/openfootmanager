import { useEffect } from "react";
import { online } from "../client";
import { readAccountRing, watchAccount } from "../live";
import {
  refreshFinance,
  refreshFriendly,
  refreshMarket,
  useOnlineStore,
} from "../store/onlineStore";

const ignore = () => undefined;

/** The club's money and market read again: after a market ring, and when the shell opens. */
function refreshMoney(): void {
  void refreshFinance().catch(ignore);
  void refreshMarket().catch(ignore);
}

/**
 * Follows the coach's own account channel for as long as they are in the online mode (S12-22,
 * C-5 C5-10). A ring says whose news it is: a friendly ring reads their friendly again; a market
 * ring (outbid, won, sold, …) reads the club's money and market again and lights the market's
 * dot. Holding the channel is also what keeps them present in the friendly queue, whichever online
 * page they are on. Nothing here is shown: a failure leaves each page to read for itself.
 */
export function AccountWatcher() {
  useEffect(() => {
    let live = true;
    let stop: (() => Promise<void>) | undefined;
    const ring = (data: unknown) => {
      const news = readAccountRing(data);
      if (news.kind === "friendly") {
        void refreshFriendly().catch(ignore);
      } else if (news.kind === "market") {
        refreshMoney();
        useOnlineStore.setState((state) => ({ marketUnseen: state.marketUnseen + 1 }));
      }
    };
    online.me
      .get()
      .then((account) => {
        if (!live) return undefined;
        useOnlineStore.setState({ accountId: account.id });
        void refreshFriendly().catch(ignore);
        refreshMoney();
        return watchAccount(account.id, ring);
      })
      .then((stopWatching) => {
        if (!stopWatching) return;
        if (live) stop = stopWatching;
        else void stopWatching();
      })
      .catch(ignore);
    return () => {
      live = false;
      void stop?.();
    };
  }, []);
  return null;
}
