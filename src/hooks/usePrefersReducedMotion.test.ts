import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { prefersReducedMotion, usePrefersReducedMotion } from "./usePrefersReducedMotion";

function fakeQuery(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  return {
    change(matches: boolean) {
      query.matches = matches;
      for (const listener of listeners) listener();
    },
  };
}

describe("usePrefersReducedMotion", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Given a browser without matchMedia (the test DOM), then motion is allowed.
  it("allows motion when the browser cannot say", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  // Given a player who asks for reduced motion, when he turns it off while the
  // screen is open, then the hook follows him.
  it("follows the system setting as it changes", () => {
    const query = fakeQuery(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    act(() => query.change(false));
    expect(result.current).toBe(false);
  });
});
