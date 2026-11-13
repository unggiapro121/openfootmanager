import { useOnlineNow } from "../clock";
import { claimsWaiting, giftWaiting, useOnlineStore } from "../store/onlineStore";
import { useUnseenCompletion } from "./facilities/seen";
import type { NavGroup } from "./shellNav";

/**
 * What waits on each page of the navigation, one rule for the sidebar, the phone's tab bar and
 * its sheets: market news unseen, an academy report unseen, a completed build unseen, rewards of
 * events to claim, a step of the daily gift to claim. A page with nothing waiting gives 0.
 */
export function useNavBadges(): (path: string) => number {
  const marketUnseen = useOnlineStore((state) => state.marketUnseen);
  const academyUnseen = useOnlineStore((state) => state.academyUnseen);
  const claims = useOnlineStore((state) => claimsWaiting(state.events));
  const items = useOnlineStore((state) => state.items);
  const gift = giftWaiting(items, useOnlineNow());
  const built = useUnseenCompletion() ? 1 : 0;
  return (path) => {
    if (path === "/online/market") return marketUnseen;
    if (path === "/online/academy") return academyUnseen ? 1 : 0;
    if (path === "/online/facilities") return built;
    if (path === "/online/events") return claims;
    if (path === "/online/inventory") return gift;
    return 0;
  };
}

/** What waits in a group: its pages' together, so a tab's dot is the sum of its sheet's. */
export function groupBadge(group: NavGroup, badgeOf: (path: string) => number): number {
  return group.entries.reduce((sum, entry) => sum + badgeOf(entry.path), 0);
}
