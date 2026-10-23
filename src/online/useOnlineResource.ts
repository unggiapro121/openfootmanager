import { type DependencyList, useCallback, useEffect, useState } from "react";

/** A view one online screen reads for itself: loading, then the data or the failure. */
export type OnlineResource<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "failed"; error: unknown };

/**
 * Read `load` when the screen opens and whenever `deps` change (C-2 §3.2, C2-3). A view every
 * page shares lives in the online store; this is for what one page alone shows. An answer that
 * comes back after the deps changed is dropped.
 */
export function useOnlineResource<T>(
  load: () => Promise<T>,
  deps: DependencyList,
): { resource: OnlineResource<T>; reload: () => void } {
  const [resource, setResource] = useState<OnlineResource<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  // `load` is rebuilt each render; `deps` say when it reads something else.
  useEffect(() => {
    let current = true;
    setResource({ status: "loading" });
    load()
      .then((data) => current && setResource({ status: "ready", data }))
      .catch((error: unknown) => current && setResource({ status: "failed", error }));
    return () => {
      current = false;
    };
  }, [...deps, attempt]);

  return { resource, reload };
}
