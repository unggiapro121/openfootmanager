import { useEffect, useState } from "react";
import { refreshClub } from "../../store/onlineStore";

/** How often the club is read again while today's day job has not run, and for how long. */
export const PENDING_FAST_MS = 5_000;
export const PENDING_FAST_READS = 24;
export const PENDING_SLOW_MS = 30_000;
export const PENDING_SLOW_READS = 20;

const ignore = () => undefined;

/**
 * While the card says today's day job has not run (`dayPending`, C-8 C8-8): the club is read
 * again every 5 s for two minutes, then every 30 s for ten more, then no more. `slow` is true
 * from the third minute on, when the card offers a reload of its own. It stops as soon as the
 * club's refusal is another one. The day turns for every club of the region at once, so this is
 * the refusal a coach meets most, right after the shell read the club for the new day.
 */
export function useDayPendingPoll(pending: boolean): { slow: boolean } {
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!pending) setReads(0);
  }, [pending]);

  useEffect(() => {
    if (!pending || reads >= PENDING_FAST_READS + PENDING_SLOW_READS) return;
    const delay = reads < PENDING_FAST_READS ? PENDING_FAST_MS : PENDING_SLOW_MS;
    const timer = setTimeout(() => {
      setReads((done) => done + 1);
      void refreshClub().catch(ignore);
    }, delay);
    return () => clearTimeout(timer);
  }, [pending, reads]);

  return { slow: pending && reads >= PENDING_FAST_READS };
}
