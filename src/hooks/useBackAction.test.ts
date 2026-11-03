import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { runBackAction } from "../lib/backActions";
import { useBackAction } from "./useBackAction";

describe("useBackAction", () => {
  // Given a sheet that holds Back while open,
  // when it is open, then closed,
  // then Back runs its action only while it is open.
  it("holds Back only while active", () => {
    const close = vi.fn();
    const { rerender, unmount } = renderHook(({ open }) => useBackAction(open, close), {
      initialProps: { open: true },
    });
    expect(runBackAction()).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);

    rerender({ open: false });
    expect(runBackAction()).toBe(false);
    unmount();
  });
});
