import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORLD_PACKAGE_ID,
  initialPackageSelection,
} from "./defaultWorldPackage";

describe("initialPackageSelection", () => {
  // Given the real-world package is installed and the player has chosen nothing yet,
  // when the packages step loads, then it opens with that package already selected.
  it("pre-selects the default world package when it is installed", () => {
    expect(
      initialPackageSelection([DEFAULT_WORLD_PACKAGE_ID, "other"], [], false),
    ).toEqual([DEFAULT_WORLD_PACKAGE_ID]);
  });

  // Given the player has unticked every package, when the list reloads (returning to the
  // step, installing another package), then nothing is re-selected: an empty choice means
  // "generate a random world" and must be respected.
  it("respects a player who unticks the default to play a random world", () => {
    expect(
      initialPackageSelection([DEFAULT_WORLD_PACKAGE_ID], [], true),
    ).toEqual([]);
  });

  // Given the player already picked other packages, when the list reloads, then the
  // choice is kept as it is.
  it("keeps an existing selection", () => {
    expect(
      initialPackageSelection(
        [DEFAULT_WORLD_PACKAGE_ID, "other"],
        ["other"],
        false,
      ),
    ).toEqual(["other"]);
  });

  // Given the default package is not installed, when the step loads, then nothing is
  // selected and the random-world fallback applies as before.
  it("selects nothing when the default package is not installed", () => {
    expect(initialPackageSelection(["other"], [], false)).toEqual([]);
  });
});
