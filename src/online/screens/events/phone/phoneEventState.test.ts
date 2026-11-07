import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { EventView, MissionView } from "../../../api";
import {
  firstOpen,
  isDone,
  longCountdown,
  percentOf,
  progressText,
  segmentsOf,
  shortCountdown,
  showsBar,
} from "./phoneEventState";

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${Object.values(options).join("|")}` : key) as unknown as TFunction;

function mission(overrides: Partial<MissionView> = {}): MissionView {
  return {
    code: "m",
    kind: "leagueMatchesDirected",
    target: 3,
    progress: 1,
    status: "active",
    rewards: [{ coin: 20, quantity: 1 }],
    countsOffline: false,
    ...overrides,
  };
}

function event(overrides: Partial<EventView> = {}): EventView {
  return {
    id: "e",
    theme: "weekly",
    startsAt: "2000-01-01T00:00:00Z",
    endsAt: "2099-01-01T00:00:00Z",
    claimUntil: "2099-01-01T00:00:00Z",
    state: "running",
    missions: [mission()],
    ...overrides,
  };
}

describe("segmentsOf", () => {
  // Given a running event with one mission of each kind of ending,
  // when its card's bar is drawn,
  // then the claimed come first, then those waiting, then the open, then the failed.
  it("orders the segments claimed, waiting, open", () => {
    const missions = [
      mission({ code: "a", status: "active" }),
      mission({ code: "b", status: "completed" }),
      mission({ code: "c", status: "lapsed" }),
      mission({ code: "d", status: "claimed" }),
    ];
    expect(segmentsOf(event({ missions })).map((segment) => segment.tone)).toEqual([
      "claimed",
      "ready",
      "open",
      "failed",
    ]);
  });

  // Given an event that ended with a mission unfinished,
  // when its bar is drawn,
  // then that mission's segment is a failed one.
  it("marks an unfinished mission of an ended event as failed", () => {
    expect(segmentsOf(event({ state: "ended" }))).toEqual([{ code: "m", tone: "failed" }]);
  });
});

describe("firstOpen", () => {
  // Given two running events, the later one with a reward waiting,
  // when the page opens,
  // then the one with the reward is the card open.
  it("opens the first event with a reward waiting", () => {
    const soon = event({ id: "soon" });
    const waiting = event({ id: "waiting", missions: [mission({ status: "completed" })] });
    expect(firstOpen([soon, waiting])).toBe("waiting");
  });

  // Given running events and none with a reward waiting,
  // when the page opens,
  // then the first one, which ends soonest, is open.
  it("opens the running event that ends soonest when nothing waits", () => {
    expect(firstOpen([event({ id: "soon" }), event({ id: "late" })])).toBe("soon");
  });

  // Given only an ended event with nothing left to claim,
  // when the page opens,
  // then no card is open.
  it("opens none when no event runs or waits", () => {
    expect(firstOpen([event({ state: "ended", missions: [mission({ status: "claimed" })] })])).toBe(
      undefined,
    );
  });
});

describe("countdowns", () => {
  // Given four days and some hours left,
  // when a folded and an open card show them,
  // then the folded one stops at the hour and the open one counts the seconds.
  it("says days and hours folded, the clock open", () => {
    const left = { days: 4, clock: "09:35:53" };
    expect(shortCountdown(t, left)).toBe("online.events.phone.short:4|09");
    expect(longCountdown(t, left)).toBe("online.events.phone.long:4|09:35:53");
  });

  // Given less than a day left,
  // when either card shows it,
  // then it is the clock alone.
  it("shows the clock alone under a day", () => {
    const left = { days: 0, clock: "05:04:03" };
    expect(shortCountdown(t, left)).toBe("05:04:03");
    expect(longCountdown(t, left)).toBe("05:04:03");
  });
});

describe("progressText", () => {
  // Given a counted mission under way,
  // when its row is drawn,
  // then it reads as progress over target, with a bar.
  it("counts a counted mission", () => {
    const counted = mission({ progress: 4, target: 3 });
    expect(progressText(t, counted, "ready")).toBe("3/3");
    expect(showsBar(counted, "ready")).toBe(true);
    expect(percentOf(counted)).toBe(100);
  });

  // Given a season-end mission, whose target is a rank,
  // when its row is drawn,
  // then it says met or not, with no bar.
  it("says met or not for a season-end mission", () => {
    const top = mission({ kind: "seasonFinishTop", target: 3, progress: 0 });
    expect(progressText(t, top, "active")).toBe("online.events.notMet");
    expect(showsBar(top, "active")).toBe(false);
  });

  // Given a claimed mission,
  // when its row is drawn,
  // then it says so, with no bar, and it belongs under "Done".
  it("says a claimed mission is claimed", () => {
    expect(progressText(t, mission({ status: "claimed" }), "claimed")).toBe(
      "online.events.claimed",
    );
    expect(showsBar(mission(), "claimed")).toBe(false);
    expect(isDone("claimed")).toBe(true);
    expect(isDone("ready")).toBe(false);
  });
});
