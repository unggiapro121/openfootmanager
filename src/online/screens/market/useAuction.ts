import { useCallback, useEffect, useRef, useState } from "react";
import type { AuctionView } from "../../api";
import { online } from "../../client";
import { watchAuction } from "../../live";
import { tracked } from "../../store/onlineStore";

export type LoadedAuction =
  | { status: "loading" }
  | { status: "failed"; error: unknown }
  | { status: "ready"; view: AuctionView };

/**
 * One auction as its page reads it: read once, then, while it is open, read again on each newer
 * notice of `auction:{id}`. A failed read again keeps what was shown.
 */
export function useAuction(auctionId: string) {
  const [loaded, setLoaded] = useState<LoadedAuction>({ status: "loading" });
  const lastSeq = useRef(0);

  const load = useCallback(() => {
    tracked(() => online.market.byId(auctionId))
      .then((view) => setLoaded({ status: "ready", view }))
      .catch((error: unknown) =>
        setLoaded((current) =>
          current.status === "ready" ? current : { status: "failed", error },
        ),
      );
  }, [auctionId]);

  useEffect(() => {
    setLoaded({ status: "loading" });
    lastSeq.current = 0;
    load();
  }, [load]);

  const active = loaded.status === "ready" && loaded.view.status === "active";
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    let stop: (() => Promise<void>) | undefined;
    watchAuction(auctionId, (notice) => {
      if (notice.seq <= lastSeq.current) return;
      lastSeq.current = notice.seq;
      load();
    })
      .then((stopWatching) => {
        if (live) stop = stopWatching;
        else void stopWatching();
      })
      .catch(() => undefined);
    return () => {
      live = false;
      void stop?.();
    };
  }, [active, auctionId, load]);

  const setView = useCallback((view: AuctionView) => setLoaded({ status: "ready", view }), []);
  return { loaded, setView, load };
}
