import { describe, expect, it } from "vitest";
import type { EventView, MissionView } from "../../api";
import {
  eventGroup,
  journeyCounts,
  missionLeft,
  missionPhase,
  missionsInOrder,
} from "./missionState";

function mission(overrides: Partial<MissionView> = {}): MissionView {
  return {
    code: "w1",
    kind: "leagueMatchesDirected",
    target: 5,
    progress: 0,
    status: "active",
    rewards: [],
    countsOffline: false,
    ...overrides,
  };
}

function event(state: string, missions: MissionView[] = []): EventView {
  return {
    id: "e",
    theme: "weekly",
    startsAt: "2000-01-01T00:00:00Z",
    endsAt: "2099-01-01T00:00:00Z",
    claimUntil: "2099-01-01T00:00:00Z",
    state,
    missions,
  };
}

describe("eventGroup", () => {
  // Given the four states and one this build does not know,
  // when each is grouped,
  // then the known ones keep their name and the unknown one is closed.
  it("reads an unknown state as closed", () => {
    expect(["running", "ended", "scheduled", "closed", "paused"].map(eventGroup)).toEqual([
      "running",
      "ended",
      "scheduled",
      "closed",
      "closed",
    ]);
  });
});

describe("missionPhase", () => {
  // Given a finished mission in each event state,
  // when its phase is read,
  // then it can be claimed while the event runs or takes claims, and is claimed for the coach
  // once the event closed.
  it("tells a claim waiting from one made for the coach", () => {
    const done = mission({ status: "completed" });
    expect(missionPhase(event("running"), done)).toBe("ready");
    expect(missionPhase(event("ended"), done)).toBe("ready");
    expect(missionPhase(event("closed"), done)).toBe("autoClaiming");
    expect(missionPhase(event("paused"), done)).toBe("autoClaiming");
  });

  // Given an unfinished mission in each event state,
  // when its phase is read,
  // then it is under way while the event runs, not started before it, and missed after it.
  it("tells a mission under way from one missed", () => {
    const open = mission();
    expect(missionPhase(event("running"), open)).toBe("active");
    expect(missionPhase(event("scheduled"), open)).toBe("upcoming");
    expect(missionPhase(event("ended"), open)).toBe("missed");
    expect(missionPhase(event("closed"), open)).toBe("missed");
  });

  // Given a claimed and a lapsed mission,
  // when their phase is read in any event,
  // then it is their status.
  it("keeps claimed and lapsed whatever the event", () => {
    expect(missionPhase(event("running"), mission({ status: "claimed" }))).toBe("claimed");
    expect(missionPhase(event("closed"), mission({ status: "lapsed" }))).toBe("lapsed");
  });
});

describe("missionsInOrder", () => {
  // Given missions done, waiting, under way and lapsed, in the server's order,
  // when they are ordered for the page,
  // then the waiting claim comes first, then the one under way, then the finished ones in the
  // server's order.
  it("puts the claims waiting first", () => {
    const missions = [
      mission({ code: "claimed", status: "claimed" }),
      mission({ code: "open" }),
      mission({ code: "lapsed", status: "lapsed" }),
      mission({ code: "ready", status: "completed" }),
    ];
    expect(missionsInOrder(event("running", missions)).map((one) => one.code)).toEqual([
      "ready",
      "open",
      "claimed",
      "lapsed",
    ]);
  });
});

describe("journeyCounts", () => {
  // Given an event with one mission claimed, one waiting, one lapsed and one under way,
  // when its journey is counted,
  // then three are met, one claimed and one waiting, of four.
  it("counts the met, claimed and waiting missions", () => {
    const missions = [
      mission({ status: "claimed" }),
      mission({ status: "completed" }),
      mission({ status: "lapsed" }),
      mission(),
    ];
    expect(journeyCounts(event("running", missions))).toEqual({
      met: 3,
      claimed: 1,
      ready: 1,
      total: 4,
    });
  });
});

describe("missionLeft", () => {
  // Given counted missions part done and over done, a season-end one and one without a target,
  // when what is left is read,
  // then the counted ones say what is left, never below zero, and the others say nothing.
  it("says what is left of a counted mission only", () => {
    expect(missionLeft(mission({ progress: 2 }))).toBe(3);
    expect(missionLeft(mission({ progress: 9 }))).toBe(0);
    expect(missionLeft(mission({ kind: "seasonPromoted", target: 1 }))).toBeUndefined();
    expect(missionLeft(mission({ target: 0 }))).toBeUndefined();
  });
});
