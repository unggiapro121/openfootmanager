import { useCallback, useEffect, useState } from "react";
import type { FacilitiesView } from "../../api";
import { useOnlineNow } from "../../clock";
import { refreshFacilities, refreshFinance, useOnlineStore } from "../../store/onlineStore";
import { buildClock } from "./cardState";

/** How often a build past its end is read again (c-27 §5.2, R27-1), in milliseconds. */
const DUE_EVERY_MS = 10_000;
const AFTER_MATCH_EVERY_MS = 60_000;

/**
 * The facilities screen's data (c-27 §5.2, C27-10): the facilities view and the club's money,
 * read when the screen opens, with the failure of that read for a retry. A build whose end has
 * passed is read again every 10 s until the server's day tick completes it, or every 60 s while
 * a match's lineup lock holds it (R27-1); the account ring's `facilities` event reads it at once
 * (AccountWatcher).
 */
export function useFacilitiesScreen() {
  const view = useOnlineStore((state) => state.facilities);
  const finance = useOnlineStore((state) => state.finance);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([refreshFacilities(), refreshFinance()]).catch(setLoadError);
  }, []);
  useEffect(load, [load]);
  useBuildDueReread(view);

  return { view, finance, loadError, load };
}

function useBuildDueReread(view: FacilitiesView | null | undefined) {
  const now = useOnlineNow();
  const offset = useOnlineStore((state) => state.facilitiesOffsetMs);
  const build = view?.build ?? null;
  const kind = build ? buildClock(build, view?.lineupLocked ?? false, now, offset).kind : null;
  const every = kind === "due" ? DUE_EVERY_MS : kind === "afterMatch" ? AFTER_MATCH_EVERY_MS : null;

  useEffect(() => {
    if (every === null) return;
    const read = () => void refreshFacilities().catch(() => undefined);
    read();
    const timer = window.setInterval(read, every);
    return () => window.clearInterval(timer);
  }, [every]);
}
