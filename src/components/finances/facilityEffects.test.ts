import { describe, expect, it } from "vitest";

import { effectChanges, formatFacilityEffect } from "./facilityEffects";

describe("formatFacilityEffect", () => {
  it("writes each format as the dialog shows it", () => {
    expect(formatFacilityEffect("multiplier", [1.3], "en")).toBe("×1.3");
    expect(formatFacilityEffect("multiplier", [1], "en")).toBe("×1.0");
    expect(formatFacilityEffect("percentChange", [-16], "en")).toBe("-16%");
    expect(formatFacilityEffect("percentChange", [8], "en")).toBe("+8%");
    expect(formatFacilityEffect("percent", [7.5], "en")).toBe("7.5%");
    expect(formatFacilityEffect("count", [3], "en")).toBe("+3");
    expect(formatFacilityEffect("value", [99], "en")).toBe("99");
    expect(formatFacilityEffect("split", [64.2, 27.3, 8.5], "en")).toBe("64.2% / 27.3% / 8.5%");
  });

  it("returns null for an effect that changes nothing yet", () => {
    expect(formatFacilityEffect("percentChange", [0], "en")).toBeNull();
    expect(formatFacilityEffect("count", [0], "en")).toBeNull();
  });

  it("follows the player's language", () => {
    expect(formatFacilityEffect("multiplier", [1.3], "vi")).toBe("×1,3");
    // German puts a no-break space before the percent sign.
    expect(formatFacilityEffect("percent", [7.5], "de")).toBe("7,5\u00a0%");
  });
});

describe("effectChanges", () => {
  it("tells a moving effect from a still one and the top level", () => {
    expect(effectChanges([1.3], [1.4])).toBe(true);
    expect(effectChanges([99], [99])).toBe(false);
    expect(effectChanges([5], null)).toBe(false);
  });
});
