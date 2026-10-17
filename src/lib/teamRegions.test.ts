import { describe, expect, it } from "vitest";

import nationRegions from "./nationRegions.generated.json";
import { inferRegionId } from "./teamRegions";

describe("inferRegionId", () => {
  /**
   * Given a world with V.League and Indian Super League clubs,
   * when club selection groups their countries by region,
   * then Vietnam and India sit under Asia, not the Europe default.
   */
  it("places Vietnam and India in Asia", () => {
    expect(inferRegionId("VN")).toBe("asia");
    expect(inferRegionId("IN")).toBe("asia");
  });

  /**
   * Given every nation the backend catalog knows,
   * when the frontend infers its region,
   * then it agrees with the catalog's region for that nation.
   */
  it("agrees with the backend nation catalog for every nation", () => {
    for (const [code, region] of Object.entries(nationRegions)) {
      expect(inferRegionId(code), code).toBe(region);
    }
  });

  /**
   * Given a country code the catalog does not know,
   * when its region is inferred,
   * then it falls back to Europe, as the backend's region_for_code does.
   */
  it("falls back to Europe for an unknown code", () => {
    expect(inferRegionId("XX")).toBe("europe");
  });
});
