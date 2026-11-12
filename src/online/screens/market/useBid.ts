import { useState } from "react";
import type { AuctionView } from "../../api";
import { online } from "../../client";
import { askForPushOnce } from "../../push/pushDevice";
import { refreshFinance, refreshMarket, tracked } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";

/**
 * Codes after which the auction is read again: what the coach saw is out of date. A level cap's
 * refusal is one: the coach's level or squad changed since the page was read (C-7 C7-11).
 */
const STALE_CODES = new Set([
  "be.error.auction.bidTooLow",
  "be.error.auction.listingExpired",
  "be.error.auction.levelCapPlayer",
  "be.error.auction.levelCapSquad",
]);

/** A bid of at least this share of the club's cash asks first (C5-8). */
export const CONFIRM_SHARE_OF_CASH = 0.5;

/** Why a bid would be refused before it is sent: the server still decides (C-5 §3.5). */
export function bidProblem(amount: number | null, view: AuctionView, cash: number | undefined) {
  if (amount === null || !Number.isInteger(amount)) return "invalid";
  if (amount < view.minNextBid) return "tooLow";
  if (amount > view.priceCap) return "overCap";
  if (cash !== undefined && amount > cash) return "overCash";
  return null;
}

/**
 * Sends a bid: the auction the server answers with replaces the page's, the club's cash and its
 * market are read again, and a refusal that means the page is out of date reads the auction again.
 */
export function useBidSender(
  view: AuctionView,
  onView: (view: AuctionView) => void,
  reload: () => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();
  const send = (amount: number, after?: () => void) => {
    setBusy(true);
    setError(null);
    run((key) => tracked(() => online.market.bid(view.id, amount, key)), String(amount))
      .then((next) => {
        onView(next);
        after?.();
        // The first bid that went through is when pushes start to matter (D-P5-15).
        askForPushOnce();
        void refreshFinance().catch(() => undefined);
        void refreshMarket().catch(() => undefined);
      })
      .catch((failure: { code?: string }) => {
        setError(failure);
        if (failure.code && STALE_CODES.has(failure.code)) reload();
      })
      .finally(() => setBusy(false));
  };
  return { send, busy, error };
}
