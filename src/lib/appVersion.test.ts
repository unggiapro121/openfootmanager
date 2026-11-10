import { describe, expect, it } from "vitest";
import { withBuild } from "./appVersion";

describe("the version shown in About", () => {
  // Given a phone build with a store build number (scripts/build-mobile.sh, M2b-7),
  // when About writes the version,
  // then the build follows it in brackets: version (build) (m2-tech-spec N1).
  it("adds the store build number in brackets", () => {
    expect(withBuild("v0.3.0-dev · f164fcd", "7")).toBe("v0.3.0-dev · f164fcd (7)");
  });

  // Given any other build, whose build number is empty,
  // when About writes the version,
  // then it is the version alone, as before.
  it("leaves the version alone without a build number", () => {
    expect(withBuild("v0.4.0", "")).toBe("v0.4.0");
  });
});
