import { describe, expect, it } from "vitest";
import { matchEvent } from "../../../test-utils/onlineMatchKit";
import type { OnlineMatchState } from "../../convert/matchState";
import { remember, shownAt } from "./liveShown";

/** A state of a match with `events` events so far, told apart by its minute. */
const at = (minute: number, events: number) =>
  ({
    minute,
    events: Array.from({ length: events }, () => matchEvent("PassCompleted", "Home", "h1")),
  }) as unknown as OnlineMatchState;

describe("the states a live screen may still show", () => {
  // Given states at minutes 1 and 2 kept, when minute 3 arrives, then it is kept after them,
  // and the same state again adds nothing.
  it("keeps each new state after the others", () => {
    const one = at(1, 3);
    const two = at(2, 5);
    const three = at(3, 8);
    const kept = remember(remember(remember([], one), two), three);
    expect(kept).toEqual([one, two, three]);
    expect(remember(kept, three)).toEqual([one, two, three]);
  });

  // Given states kept up to minute 3 with 8 events, when the match is read again with fewer,
  // then only the new reading is kept.
  it("starts again when the match comes back with fewer events", () => {
    const again = at(1, 2);
    expect(remember([at(2, 5), at(3, 8)], again)).toEqual([again]);
  });
});

describe("the state a live screen shows", () => {
  const kept = [at(1, 3), at(2, 5), at(3, 5), at(4, 8)];

  // Given the radar has played out 5 events, when the screen picks a state,
  // then it shows the newest one with no more than 5: minute 3, a minute with nothing in it.
  it("shows the newest state the radar has played out", () => {
    expect(shownAt(kept, 5).minute).toBe(3);
    expect(shownAt(kept, 7).minute).toBe(3);
    expect(shownAt(kept, 8).minute).toBe(4);
  });

  // Given the radar has played out fewer events than even the oldest state kept,
  // when the screen picks a state, then it shows the oldest one.
  it("shows the oldest state kept when the radar is further behind", () => {
    expect(shownAt(kept, 1).minute).toBe(1);
  });
});
