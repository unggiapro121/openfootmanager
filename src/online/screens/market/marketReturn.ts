/**
 * The way back from an auction to the market as it was left (C5-6): the market's filters live in
 * its address, so an auction opened from it carries that address in the navigation's state.
 */
const MARKET = "/online/market";

/** The navigation state an auction opened from the market at `search` carries. */
export function fromMarket(search: string): { market: string } {
  return { market: search };
}

/** The market to go back to: the one the auction was opened from, or the market as it opens. */
export function marketBack(state: unknown): string {
  const search =
    state && typeof state === "object" && "market" in state
      ? (state as { market: unknown }).market
      : "";
  return typeof search === "string" && search.startsWith("?") ? `${MARKET}${search}` : MARKET;
}
