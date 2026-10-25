import { useEffect } from "react";
import { watchLeague } from "../live";
import { refreshClub, refreshLeague, useOnlineStore } from "../store/onlineStore";

/** How long after a league notice the club is read again: a round settles in a burst of them. */
export const SETTLE_MS = 2_000;
/** How often the club is read again while its next fixture is under way, in case no notice comes. */
export const POLL_MS = 30_000;

const ignore = () => undefined;

function readAgain(): void {
  void refreshClub().catch(ignore);
  void refreshLeague().catch(ignore);
}

/**
 * Keeps the club's next fixture and its lineup lock the server's while a match is played. The
 * club is otherwise read only when the region's day turns, so a match that ended left the coach
 * looking at it as under way, his lineup locked, until then. It follows the league's channel and
 * reads the club and the league again after each burst of fixture notices, and, should no notice
 * come (the realtime connection down), reads the club every POLL_MS while the next fixture has
 * kicked off.
 */
export function LeagueWatcher() {
  const leagueId = useOnlineStore((state) => state.club?.leagueId);
  const kickoffAt = useOnlineStore((state) => state.club?.nextFixture?.kickoffAt);

  useEffect(() => {
    if (!leagueId) return;
    let live = true;
    let stop: (() => Promise<void>) | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onNotice = () => {
      clearTimeout(settle);
      settle = setTimeout(readAgain, SETTLE_MS);
    };
    watchLeague(leagueId, onNotice)
      .then((stopWatching) => {
        if (live) stop = stopWatching;
        else void stopWatching().catch(ignore);
      })
      .catch(ignore);
    return () => {
      live = false;
      clearTimeout(settle);
      void stop?.().catch(ignore);
    };
  }, [leagueId]);

  useEffect(() => {
    if (!kickoffAt) return;
    const kickoff = Date.parse(kickoffAt);
    if (Number.isNaN(kickoff)) return;
    let poll: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      poll = setInterval(() => void refreshClub().catch(ignore), POLL_MS);
    };
    const wait = setTimeout(start, Math.max(0, kickoff - Date.now()));
    return () => {
      clearTimeout(wait);
      clearInterval(poll);
    };
  }, [kickoffAt]);

  return null;
}
