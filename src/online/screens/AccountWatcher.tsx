import { useEffect } from "react";
import type { EventsView } from "../api";
import { online } from "../client";
import { type AccountRing, readAccountRing, watchAccount } from "../live";
import {
  refreshAcademy,
  refreshClub,
  refreshCoins,
  refreshEvents,
  refreshFinance,
  refreshFriendly,
  refreshItems,
  refreshMarket,
  useOnlineStore,
} from "../store/onlineStore";
import { reportHref } from "./opponent/report/reportParts";

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
  if (ring.reason !== undefined) params.reason = ring.reason;
  if (ring.requiredLevel !== undefined) params.requiredLevel = ring.requiredLevel;
  // A seller whose winner was over the level caps: the notice opens the player's new auction.
  const opens = ring.relistedAuctionId ?? ring.auctionId;
  if (ring.relistedAuctionId !== undefined) params.relisted = 1;
  useOnlineStore.getState().pushNotice({
    kind: "market",
    event: ring.event ?? "changed",
    link: opens ? `/online/auctions/${opens}` : undefined,
    params,
  });
}

/** Item events the coach did not do himself, so a notice tells him (C-7 C7-34, S-17d). */
const ITEM_NOTICES: Record<string, string> = {
  granted: "/online/inventory",
  revoked: "/online/inventory",
  refunded: "/online/coins",
};

/**
 * A notice for an item given or taken back, or a purchase refunded; a use or a purchase is the
 * coach's own.
 */
function itemNoticeOf(ring: Extract<AccountRing, { kind: "items" }>): void {
  const link = ring.event ? ITEM_NOTICES[ring.event] : undefined;
  if (!link || !ring.event) return;
  const params: Record<string, string | number> = {};
  if (ring.itemCode) params.item = ring.itemCode;
  if (ring.quantity !== undefined) params.quantity = ring.quantity;
  useOnlineStore.getState().pushNotice({ kind: "items", event: ring.event, link, params });
}

/** The missions `after` shows finished that `before` did not, with their kind and target. */
function newlyCompleted(before: EventsView, after: EventsView): { kind: string; target: number }[] {
  const was = new Map<string, string>();
  for (const event of before.events) {
    for (const mission of event.missions) was.set(`${event.id}:${mission.code}`, mission.status);
  }
  return after.events.flatMap((event) =>
    event.missions
      .filter(
        (mission) =>
          mission.status === "completed" && was.get(`${event.id}:${mission.code}`) !== "completed",
      )
      .map((mission) => ({ kind: mission.kind, target: mission.target })),
  );
}

/**
 * A mission finished (C-7 C7-57): the events read again, and a notice for each mission that went
 * from not finished to finished. The ring names no mission, so with no events read before there
 * is nothing to compare: one notice says a mission finished.
 */
function eventNoticesOf(before: EventsView | null | undefined, after: EventsView | null): void {
  const push = useOnlineStore.getState().pushNotice;
  if (!before || !after) {
    push({ kind: "event", event: "completed", link: "/online/events", params: {} });
    return;
  }
  for (const mission of newlyCompleted(before, after)) {
    push({ kind: "event", event: "completed", link: "/online/events", params: mission });
  }
}

/**
 * Follows the coach's own account channel for as long as they are in the online mode (S12-22,
 * C-5 C5-10). A ring says whose news it is: a friendly ring reads their friendly again; a market
 * ring (outbid, won, sold, …) reads the club, its money and the market again, lights the market's
 * dot and shows a notice in the corner (`OnlineNotices`); a finance ring (the coach's coins
 * changed, C-7a1) reads the coins and the club's money again, with no notice; an items ring (C-7b)
 * reads the inventory again, with a notice only for an item given or a purchase refunded; an
 * academy ring (C-7c) reads the academy again, and a report back lights the academy's dot and
 * shows a notice; an event ring (C-7d) reads the events again, with a notice for each mission
 * just finished; a scouting report ring (C-24b) has the report read again where it is shown, and
 * one back shows a notice. Holding the channel is also what keeps them present in the friendly queue, whichever online
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
      } else if (news.kind === "academy") {
        // A report back: the academy page reads it again; the dot and a notice say so elsewhere.
        void refreshAcademy().catch(ignore);
        if (news.event === "scoutDone") {
          useOnlineStore.setState({ academyUnseen: true });
          useOnlineStore.getState().pushNotice({
            kind: "academy",
            event: news.event,
            link: "/online/academy",
            params: {},
          });
        }
      } else if (news.kind === "opponentReport") {
        // A page showing the report reads it again; one back says so in the corner.
        useOnlineStore.setState((state) => ({
          opponentReportRings: state.opponentReportRings + 1,
        }));
        if (news.event === "ready") {
          useOnlineStore.getState().pushNotice({
            kind: "opponentReport",
            event: news.event,
            link: news.reportId ? reportHref(news.reportId) : undefined,
            params: {},
          });
        }
      } else if (news.kind === "event") {
        const before = useOnlineStore.getState().events;
        void refreshEvents()
          .then((after) => {
            if (news.event === "completed") eventNoticesOf(before, after);
          })
          .catch(ignore);
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
        void refreshEvents().catch(ignore);
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
