import type { FacilitiesView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";

/**
 * Whether the coach has seen the club's last completed build (c-27 §5.6, C27-13): its
 * `completedAt` kept on this machine by club. Storage that cannot be read counts as seen, so the
 * completion layer and the dot never stay up for good.
 */
const KEY = "ofm.online.facilities.seen.";
/** The completion whose layer was last shown, apart from the card's "New" (§5.4 S8). */
const LAYER_KEY = "ofm.online.facilities.layer.";

function seenAt(clubId: string, key = KEY): string | null | undefined {
  try {
    return window.localStorage.getItem(key + clubId);
  } catch {
    // Storage off (a private window, a locked-down webview): nothing to show then.
    return undefined;
  }
}

/** The build completed and not seen yet on this machine, if any. */
export function unseenCompletion(
  view: FacilitiesView | null | undefined,
  clubId: string | undefined,
): FacilitiesView["lastCompleted"] {
  const last = view?.lastCompleted;
  if (!last || !clubId) return null;
  const seen = seenAt(clubId);
  return seen === undefined || seen === last.completedAt ? null : last;
}

/** Note the completion as seen, and have every reader of the mark read it again. */
export function markCompletionSeen(clubId: string, completedAt: string): void {
  try {
    window.localStorage.setItem(KEY + clubId, completedAt);
  } catch {
    // Unreadable storage already counts as seen; there is nothing more to keep.
  }
  useOnlineStore.setState((state) => ({ facilitiesSeen: state.facilitiesSeen + 1 }));
}

/**
 * The completion whose "done" layer the screen opens with (§5.6): unseen, and its layer not
 * shown yet, so it comes up once per completion; nothing when storage cannot be read.
 */
export function completionToShow(
  view: FacilitiesView | null | undefined,
  clubId: string | undefined,
): FacilitiesView["lastCompleted"] {
  const last = unseenCompletion(view, clubId);
  if (!last || !clubId) return null;
  const shown = seenAt(clubId, LAYER_KEY);
  return shown === undefined || shown === last.completedAt ? null : last;
}

/** Note the completion's layer as shown; the card keeps its "New" until it is seen. */
export function markLayerShown(clubId: string, completedAt: string): void {
  try {
    window.localStorage.setItem(LAYER_KEY + clubId, completedAt);
  } catch {
    // Unreadable storage never shows the layer, so nothing is lost by not keeping this.
  }
  useOnlineStore.setState((state) => ({ facilitiesSeen: state.facilitiesSeen + 1 }));
}

/** The completion whose layer the screen shows now, read again once one is shown or seen. */
export function useCompletionToShow(): FacilitiesView["lastCompleted"] {
  const view = useOnlineStore((state) => state.facilities);
  const clubId = useOnlineStore((state) => state.club?.club.id);
  useOnlineStore((state) => state.facilitiesSeen);
  return completionToShow(view, clubId);
}

/** The club's completion not seen yet, read again when the coach sees one. */
export function useUnseenCompletion(): FacilitiesView["lastCompleted"] {
  const view = useOnlineStore((state) => state.facilities);
  const clubId = useOnlineStore((state) => state.club?.club.id);
  useOnlineStore((state) => state.facilitiesSeen);
  return unseenCompletion(view, clubId);
}
