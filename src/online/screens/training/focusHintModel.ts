import type { FocusFitView } from "../../api";

/** How the focus a player trains on suits him, as the screens word it (C-13a, E5-6 §6.1). */
export type FocusHint =
  | { verdict: "best" }
  | { verdict: "fair" | "poor"; best: string }
  | { verdict: "nothing"; current: string; best: string };

/**
 * The hint for the server's `focusFit` (S-31b), or none: a resting player, no fit (at his
 * potential, injured) or no focus that lifts him say nothing. `shown` is the focus the screen
 * shows him on; a fit read for another one (the plan changed since) says nothing either.
 */
export function focusHint(fit: FocusFitView | undefined, shown?: string): FocusHint | null {
  if (!fit?.best || (shown !== undefined && fit.current !== shown)) return null;
  switch (fit.verdict) {
    case "best":
      return { verdict: "best" };
    case "fair":
    case "poor":
      return { verdict: fit.verdict, best: fit.best };
    case "nothing":
      return { verdict: "nothing", current: fit.current, best: fit.best };
    default:
      return null;
  }
}
