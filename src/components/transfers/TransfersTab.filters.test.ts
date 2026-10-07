import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRANSFER_MARKET_FILTERS,
  updateTransferMarketFilter,
} from "./TransfersTab.filters";

describe("updateTransferMarketFilter", () => {
  /** Given default filters, when one field is set by value, then only that field changes. */
  it("sets one field and leaves the rest", () => {
    const next = updateTransferMarketFilter(DEFAULT_TRANSFER_MARKET_FILTERS, "search", "smith");

    expect(next).toEqual({ ...DEFAULT_TRANSFER_MARKET_FILTERS, search: "smith" });
    expect(DEFAULT_TRANSFER_MARKET_FILTERS.search).toBe("");
  });

  /** Given a selection, when a field is set from its previous value, then the updater sees it. */
  it("applies an updater to the field's previous value", () => {
    const withCentreBacks = {
      ...DEFAULT_TRANSFER_MARKET_FILTERS,
      specificPositions: ["CenterBack"],
    };

    const next = updateTransferMarketFilter(withCentreBacks, "specificPositions", (previous) => [
      ...previous,
      "LeftBack",
    ]);

    expect(next.specificPositions).toEqual(["CenterBack", "LeftBack"]);
  });
});
