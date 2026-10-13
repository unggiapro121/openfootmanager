import { describe, expect, it } from "vitest";

import { isPlayedOut } from "./radarGate";
import { radarEvent, radarSnapshot } from "./radar/radarTestFixtures";

describe("isPlayedOut", () => {
  const fetched = {
    results: [],
    snapshot: radarSnapshot({
      events: [
        radarEvent("PassCompleted", "Home", "Midfield", "h_cm1", null, 1),
        radarEvent("Goal", "Home", "AwayBox", "h_st1", null, 2),
      ],
    }),
  };

  // Given a minute fetched for the radar, then it is shown only once the radar
  // has taken in every one of its events — never before, so a goal is never
  // in the score before the radar has played it.
  it("waits until the radar has taken in all of a minute's events", () => {
    expect(isPlayedOut(fetched, 0)).toBe(false);
    expect(isPlayedOut(fetched, 1)).toBe(false);
    expect(isPlayedOut(fetched, 2)).toBe(true);
  });
});
