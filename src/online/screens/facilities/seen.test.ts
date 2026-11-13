import { afterEach, describe, expect, it, vi } from "vitest";
import type { FacilitiesView } from "../../api";
import { completionToShow, markCompletionSeen, markLayerShown, unseenCompletion } from "./seen";

const DONE = { facility: "stands", level: 4, completedAt: "2026-11-13T12:00:00Z" };
const view = (lastCompleted: FacilitiesView["lastCompleted"]): FacilitiesView => ({
  facilities: [],
  lastCompleted,
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("a completed build seen (c-27 §5.6)", () => {
  // Given a build completed and not looked at,
  // when it is seen once,
  // then it is unseen before and seen after, for that club only; a later completion is unseen
  // again.
  it("is unseen until seen, once per completion and club", () => {
    expect(unseenCompletion(view(DONE), "club-1")).toEqual(DONE);
    markCompletionSeen("club-1", DONE.completedAt);
    expect(unseenCompletion(view(DONE), "club-1")).toBeNull();
    expect(unseenCompletion(view(DONE), "club-2")).toEqual(DONE);
    const next = { ...DONE, level: 5, completedAt: "2026-11-14T12:00:00Z" };
    expect(unseenCompletion(view(next), "club-1")).toEqual(next);
  });

  // Given no completion yet, or no club read,
  // when it is asked,
  // then there is nothing to show.
  it("has nothing without a completion or a club", () => {
    expect(unseenCompletion(view(null), "club-1")).toBeNull();
    expect(unseenCompletion(view(DONE), undefined)).toBeNull();
    expect(unseenCompletion(undefined, "club-1")).toBeNull();
  });

  // Given storage that throws when read,
  // when it is asked,
  // then the completion counts as seen, so it is never shown for good.
  it("counts unreadable storage as seen", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(unseenCompletion(view(DONE), "club-1")).toBeNull();
  });
});

describe("the completion layer shown (c-27 §5.6, T7)", () => {
  // Given a build completed and not seen,
  // when its layer has been shown once,
  // then it is not shown again for that completion, though the card's "New" stays until seen;
  // a later completion shows its layer again.
  it("shows once per completion, apart from the card's mark", () => {
    expect(completionToShow(view(DONE), "club-1")).toEqual(DONE);
    markLayerShown("club-1", DONE.completedAt);
    expect(completionToShow(view(DONE), "club-1")).toBeNull();
    expect(unseenCompletion(view(DONE), "club-1")).toEqual(DONE);
    const next = { ...DONE, facility: "shop", level: 1, completedAt: "2026-11-14T12:00:00Z" };
    expect(completionToShow(view(next), "club-1")).toEqual(next);
  });

  // Given a completion already seen on its card,
  // when the screen opens,
  // then no layer comes up for it.
  it("is not shown for a completion already seen", () => {
    markCompletionSeen("club-1", DONE.completedAt);
    expect(completionToShow(view(DONE), "club-1")).toBeNull();
  });

  // Given storage that throws when read,
  // when the screen opens,
  // then no layer comes up.
  it("is not shown when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(completionToShow(view(DONE), "club-1")).toBeNull();
  });
});
