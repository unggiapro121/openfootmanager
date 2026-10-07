import { useEffect, useRef } from "react";

import { useGameStore } from "../store/gameStore";
import { autoSaveDelayMs } from "./useAutoSave.helpers";

interface UseAutoSaveOptions {
  enabled: boolean;
  intervalMinutes: number;
  /** True while the day is advancing or a save is already running. */
  isBusy: boolean;
  save: () => Promise<void>;
}

/**
 * Save the career once it has gone `intervalMinutes` of real time with unsaved
 * changes. Never while busy: a save that falls due mid-advance waits for the
 * advance to finish, then runs.
 */
export function useAutoSave({ enabled, intervalMinutes, isBusy, save }: UseAutoSaveOptions) {
  const dirtySince = useGameStore((state) => state.dirtySince);
  const lastAttemptAt = useRef<number | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!enabled || isBusy || dirtySince === null) return;

    const attempt = () => {
      lastAttemptAt.current = Date.now();
      void saveRef.current();
    };
    const delay = autoSaveDelayMs({
      now: Date.now(),
      dirtySince,
      lastAttemptAt: lastAttemptAt.current,
      intervalMinutes,
    });
    if (delay <= 0) {
      attempt();
      return;
    }
    const timer = window.setTimeout(attempt, delay);
    return () => window.clearTimeout(timer);
  }, [enabled, isBusy, dirtySince, intervalMinutes]);
}
