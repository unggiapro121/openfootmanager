import { useEffect } from "react";
import { online } from "../client";
import { type AccountRing, readAccountRing, watchAccount } from "../live";
import {
  refreshClub,
  refreshCoins,
  refreshFinance,
  refreshFriendly,
  refreshItems,
  refreshMarket,
  useOnlineStore,
} from "../store/onlineStore";

const ignore = () => undefined;

/** The club's money and market read again: after a market ring, and when the shell opens. */
function refreshMoney(): Promise<void> {
  void refreshFinance().catch(ignore);
  return refreshMarket().catch(ignore);
}

/** A notice for a market ring, named from the market just read again when the auction is in it. */
function noticeOf(ring: Extract<AccountRing, { kind: "market" }>): void {
  const market = useOnlineStore.getState().market;
  const auction = market
    ? [...market.selling, ...market.holding, ...market.recent].find(
        (entry) => entry.id === ring.auctionId,
      )
    : undefined;
  const params: Record<string, string | number> = {};
  if (auction?.player?.fullName !== undefined) params.player = auction.player.fullName;
  if (auction?.currentPrice !== undefined) params.price = auction.currentPrice;
  useOnlineStore.getState().pushNotice({
    kind: "market",
    event: ring.event ?? "changed",
    link: ring.auctionId ? `/online/auctions/${ring.auctionId}` : undefined,
    params,
  });
}

/** Item events the coach did not do himself, so a notice tells him (C-7 C7-34). */
const ITEM_NOTICES: Record<string, string> = {
  granted: "/online/inventory",
  refunded: "/online/coins",
};

/** A notice for an item given or a purchase refunded; a use or a purchase is the coach's own. */
function itemNoticeOf(ring: Extract<AccountRing, { kind: "items" }>): void {
  const link = ring.event ? ITEM_NOTICES[ring.event] : undefined;
  if (!link || !ring.event) return;
  useOnlineStore.getState().pushNotice({
    kind: "items",
    event: ring.event,
    link,
    params: ring.itemCode ? { item: ring.itemCode } : {},
  });
}

/**
 * Follows the coach's own account channel for as long as they are in the online mode (S12-22,
 * C-5 C5-10). A ring says whose news it is: a friendly ring reads their friendly again; a market
 * ring (outbid, won, sold, …) reads the club, its money and the market again, lights the market's
 * dot and shows a notice in the corner (`OnlineNotices`); a finance ring (the coach's coins
 * changed, C-7a1) reads the coins and the club's money again, with no notice; an items ring (C-7b)
 * reads the inventory again, with a notice only for an item given or a purchase refunded. Holding the channel is also what keeps them present in the friendly queue, whichever online
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
      } else if (news.kind === "finance") {
        // Coins moved: an exchange paid the club too. No notice, the coach mostly did it.
        void refreshCoins().catch(ignore);
        void refreshFinance().catch(ignore);
      } else if (news.kind === "items") {
        // Any event, one this build does not know too, changes what the coach holds.
        void refreshItems().catch(ignore);
        itemNoticeOf(news);
      } else if (news.kind === "market") {
        useOnlineStore.setState((state) => ({ marketUnseen: state.marketUnseen + 1 }));
        // A player won, sold or given back changes the squad, which is read with the club.
        void refreshClub().catch(ignore);
        void refreshMoney().then(() => noticeOf(news));
      }
    };
    online.me
      .get()
      .then((account) => {
        if (!live) return undefined;
        useOnlineStore.setState({ accountId: account.id });
        void refreshFriendly().catch(ignore);
        void refreshCoins().catch(ignore);
        void refreshItems().catch(ignore);
        void refreshMoney();
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
