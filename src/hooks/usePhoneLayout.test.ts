import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PHONE_QUERY, isPhoneLayout, usePhoneLayout } from "./usePhoneLayout";

function fakeQuery(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  const matchMedia = vi.fn(() => query);
  vi.stubGlobal("matchMedia", matchMedia);
  return {
    matchMedia,
    change(matches: boolean) {
      query.matches = matches;
      for (const listener of listeners) listener();
    },
  };
}

describe("usePhoneLayout", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Given a browser that cannot answer media queries (the test DOM),
  // when a screen asks which layout to draw,
  // then it gets the desktop one, so every existing screen test keeps its layout.
  it("draws the desktop layout when the browser cannot say", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(isPhoneLayout()).toBe(false);
  });

  // Given a window narrower than Tailwind's md breakpoint,
  // when a screen asks,
  // then it gets the phone layout, asked with the md breakpoint's own query.
  it("draws the phone layout below the md breakpoint", () => {
    const query = fakeQuery(true);
    expect(isPhoneLayout()).toBe(true);
    expect(query.matchMedia).toHaveBeenCalledWith(PHONE_QUERY);
    expect(PHONE_QUERY).toBe("(max-width: 767.98px)");
  });

  // Given a phone turned to a wide window (a tablet in landscape, a resized browser),
  // when the width crosses the breakpoint while the screen is open,
  // then the layout follows it.
  it("follows the window as it crosses the breakpoint", () => {
    const query = fakeQuery(true);
    const { result } = renderHook(() => usePhoneLayout());
    expect(result.current).toBe(true);
    act(() => query.change(false));
    expect(result.current).toBe(false);
  });
});
