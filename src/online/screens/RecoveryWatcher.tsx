import { useEffect, useRef } from "react";
import { refreshClub, useOnlineStore } from "../store/onlineStore";

/** How long after a recovery mark the club is read: the server's clock may be a little behind. */
export const AFTER_MARK_MS = 1_000;
/** When the mark did not move after a read, the one retry comes this much later. */
export const RETRY_MS = 5_000;
/** The least time between two reads for recovery marks. */
export const MIN_GAP_MS = 60_000;

const ignore = () => undefined;

/**
 * Reads the club again at each recovery mark of a season that rests clubs by blocks (C-8 C8-8):
 * condition changes then, on every page, the lineup's included. Once per mark, never in a loop:
 * a read is set only for a mark later than the last one read for and still ahead of this
 * machine's clock, at least MIN_GAP_MS after the last such read. A read that leaves the mark
 * where it was (this clock ahead of the server's, or a region the server does not know, which
 * answers with now) is retried once after RETRY_MS, then left to the other reads (the day
 * turning, a match, a press).
 */
export function RecoveryWatcher() {
  const trainingDay = useOnlineStore((state) => state.club?.trainingDay);
  const readFor = useRef<number | null>(null);
  const retriedFor = useRef<number | null>(null);
  const lastReadAt = useRef(Number.NEGATIVE_INFINITY);
  const awaitingRead = useRef(false);

  useEffect(() => {
    if (!trainingDay) return;
    const mark = Date.parse(trainingDay.nextRecoveryAt);
    if (Number.isNaN(mark)) return;

    const read = (forMark: number) => {
      readFor.current = forMark;
      lastReadAt.current = Date.now();
      awaitingRead.current = true;
      void refreshClub().catch(ignore);
    };

    const handled = readFor.current;
    if (handled !== null && mark <= handled) {
      if (!awaitingRead.current) return;
      awaitingRead.current = false;
      if (retriedFor.current === handled) return;
      retriedFor.current = handled;
      const retry = setTimeout(() => read(handled), RETRY_MS);
      return () => clearTimeout(retry);
    }
    awaitingRead.current = false;
    if (mark <= Date.now()) return;
    const at = Math.max(mark + AFTER_MARK_MS, lastReadAt.current + MIN_GAP_MS);
    const timer = setTimeout(() => read(mark), at - Date.now());
    return () => clearTimeout(timer);
  }, [trainingDay]);

  return null;
}
