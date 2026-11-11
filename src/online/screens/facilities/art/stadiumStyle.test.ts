import { describe, expect, it } from "vitest";
import { STADIUM_STYLES, stadiumStyleOf } from "./stadiumStyle";

describe("stadiumStyleOf", () => {
  // Given each of the 16 stands levels,
  // when its stadium style is looked up,
  // then the levels map onto the 10 styles at the design's thresholds (c-27 §4.4).
  it("maps the 16 stands levels onto the 10 styles", () => {
    const levels = Array.from({ length: 16 }, (_, index) => stadiumStyleOf(index + 1));
    expect(levels).toEqual([
      "tinh",
      "gian",
      "gian",
      "anh",
      "anh",
      "hop",
      "hop",
      "mang",
      "mang",
      "buom",
      "buom",
      "chao",
      "chao",
      "so",
      "mo",
      "luoi",
    ]);
    expect(new Set(levels)).toEqual(new Set(STADIUM_STYLES));
  });

  // Given a level outside 1–16,
  // when its style is looked up,
  // then it is held to the nearest end.
  it("holds levels outside 1–16 to the ends", () => {
    expect(stadiumStyleOf(0)).toBe("tinh");
    expect(stadiumStyleOf(-3)).toBe("tinh");
    expect(stadiumStyleOf(17)).toBe("luoi");
    expect(stadiumStyleOf(99)).toBe("luoi");
  });
});
