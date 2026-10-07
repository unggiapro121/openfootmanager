import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGameStore } from "../store/gameStore";
import { useAutoSave } from "./useAutoSave";

const MINUTE = 60_000;

function markDirtyAt(time: number) {
  useGameStore.setState({ isDirty: true, dirtySince: time });
}

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    useGameStore.setState({ isDirty: false, dirtySince: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Given unsaved changes, when the interval passes, then the game saves once. */
  it("saves once the interval has passed with unsaved changes", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    markDirtyAt(0);
    renderHook(() => useAutoSave({ enabled: true, intervalMinutes: 5, isBusy: false, save }));

    act(() => vi.advanceTimersByTime(5 * MINUTE - 1));
    expect(save).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(save).toHaveBeenCalledTimes(1);
  });

  /** Given a clean game, then nothing is saved however long it sits. */
  it("does not save a game with nothing to save", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoSave({ enabled: true, intervalMinutes: 5, isBusy: false, save }));

    act(() => vi.advanceTimersByTime(60 * MINUTE));
    expect(save).not.toHaveBeenCalled();
  });

  /** Given auto-save switched off, then unsaved changes are left alone. */
  it("does nothing when switched off", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    markDirtyAt(0);
    renderHook(() => useAutoSave({ enabled: false, intervalMinutes: 5, isBusy: false, save }));

    act(() => vi.advanceTimersByTime(60 * MINUTE));
    expect(save).not.toHaveBeenCalled();
  });

  /**
   * Given a save that falls due while the day is advancing, then it waits, and
   * runs as soon as the advance finishes.
   */
  it("holds a due save until the game is no longer busy", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    markDirtyAt(0);
    const { rerender } = renderHook(
      ({ isBusy }) => useAutoSave({ enabled: true, intervalMinutes: 5, isBusy, save }),
      { initialProps: { isBusy: true } },
    );

    act(() => vi.advanceTimersByTime(10 * MINUTE));
    expect(save).not.toHaveBeenCalled();

    rerender({ isBusy: false });
    expect(save).toHaveBeenCalledTimes(1);
  });

  /** Given a save that failed, then it is not retried until another full interval passes. */
  it("does not retry a failed save in a loop", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    markDirtyAt(0);
    const { rerender } = renderHook(
      ({ isBusy }) => useAutoSave({ enabled: true, intervalMinutes: 5, isBusy, save }),
      { initialProps: { isBusy: false } },
    );

    act(() => vi.advanceTimersByTime(5 * MINUTE));
    expect(save).toHaveBeenCalledTimes(1);
    // The save ran (busy) and failed: still dirty when it finishes.
    rerender({ isBusy: true });
    rerender({ isBusy: false });
    expect(save).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(5 * MINUTE));
    expect(save).toHaveBeenCalledTimes(2);
  });
});
