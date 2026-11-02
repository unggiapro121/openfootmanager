import { useEffect, useRef } from "react";
import { pushBackAction } from "../lib/backActions";

/**
 * Hold the phone's Back with `action` while `active` (phase 5): a sheet open, a form a step in.
 * The newest action held runs first; releasing it when `active` turns false or the screen goes.
 */
export function useBackAction(active: boolean, action: () => void): void {
  const latest = useRef(action);
  latest.current = action;
  useEffect(() => {
    if (!active) return;
    return pushBackAction(() => latest.current());
  }, [active]);
}
