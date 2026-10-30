import { afterEach, describe, expect, it, vi } from "vitest";
import { myClub, squadPlayer } from "../../../test-utils/onlineTestKit";
import type { ExtraDayView, SquadPlayerView } from "../../api";
import {
  ALL_SESSIONS,
  chosenInSquad,
  conditionAfter,
  focusFull,
  focusOf,
  loadChoice,
  namesOf,
  saveChoice,
  startersUnderMatchCondition,
  stopReasonKey,
} from "./extraText";

const EXTRA: ExtraDayView = {
  canPress: true,
  today: 0,
  floor: 40,
  costs: { Low: 3, Medium: 6, High: 10 },
  sitOut: [],
};

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("the saved choice", () => {
  // Given a club the card has never seen,
  // when its choice is read,
  // then it is the whole squad, one session and no condition kept.
  it("starts with the whole squad, one session, nothing kept", () => {
    expect(loadChoice("club-1")).toEqual({ players: null, sessions: 1, keepAbove: null });
  });

  // Given a choice saved for one club,
  // when it is read back for that club and for another,
  // then the first gets it and the second the defaults.
  it("is kept per club", () => {
    saveChoice("club-1", { players: ["p2"], sessions: 5, keepAbove: 75 });
    expect(loadChoice("club-1")).toEqual({ players: ["p2"], sessions: 5, keepAbove: 75 });
    expect(loadChoice("club-2").players).toBeNull();
  });

  // Given a store holding something else, and a store that throws,
  // when the choice is read,
  // then the defaults come back and nothing is thrown.
  it("falls back to the defaults when the store is broken", () => {
    window.localStorage.setItem("ofm.online.extraTraining.club-1", "{not json");
    expect(loadChoice("club-1").players).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadChoice("club-1")).toEqual({ players: null, sessions: 1, keepAbove: null });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => saveChoice("club-1", { players: [], sessions: 1, keepAbove: null })).not.toThrow();
  });

  // Given a saved session count the card no longer offers,
  // when it is read,
  // then one session is used.
  it("reads an unknown session count as one", () => {
    window.localStorage.setItem(
      "ofm.online.extraTraining.club-1",
      JSON.stringify({ players: [], sessions: 7, keepAbove: null }),
    );
    expect(loadChoice("club-1").sessions).toBe(1);
  });
});

describe("chosenInSquad", () => {
  const squad = [squadPlayer({ id: "p1" }), squadPlayer({ id: "p2" })];

  // Given no saved choice, then a saved one naming a player who has since left,
  // when the players to send are taken,
  // then the whole squad goes, and then only the saved players still in it.
  it("sends the squad by default and never a player who left", () => {
    expect(chosenInSquad(null, squad)).toEqual(["p1", "p2"]);
    expect(chosenInSquad(["p2", "sold"], squad)).toEqual(["p2"]);
  });
});

describe("conditionAfter", () => {
  // Given players at 80, 41 and 50,
  // when sessions are counted the way the server stops them,
  // then High takes 80 to 70, a player at 41 still trains once (to 31), the floor stops a
  // player before a session, and keepAbove before one that would take him under it.
  it("stops at the floor before a session and at keepAbove after one", () => {
    expect(conditionAfter(80, 1, 10, 40, null)).toBe(70);
    expect(conditionAfter(41, 3, 10, 40, null)).toBe(31);
    expect(conditionAfter(50, ALL_SESSIONS, 3, 40, null)).toBe(38);
    expect(conditionAfter(80, 5, 3, 40, 75)).toBe(77);
  });
});

describe("startersUnderMatchCondition", () => {
  const starter = squadPlayer({ id: "p1", matchName: "Starter", condition: 80 });
  const bench = squadPlayer({ id: "p2", matchName: "Bench", condition: 50 });
  const warned = (overrides: {
    intensity: string;
    sessions: number;
    keepAbove?: number | null;
    extra?: ExtraDayView;
  }) =>
    startersUnderMatchCondition({
      players: [starter, bench],
      chosen: ["p1", "p2"],
      startingXiIds: ["p1"],
      extra: overrides.extra ?? EXTRA,
      intensity: overrides.intensity,
      sessions: overrides.sessions,
      keepAbove: overrides.keepAbove ?? null,
    }).map((player) => player.id);

  // Given a starter at 80 on a match day (C-12 §10.4),
  // when the press is High × 1, Low × 1, Low × 3, and Low × 5 keeping 75,
  // then he is warned of at 70 and 71, not at 77; a player outside the eleven never is.
  it("warns of the starters a press takes under 75", () => {
    expect(warned({ intensity: "High", sessions: 1 })).toEqual(["p1"]);
    expect(warned({ intensity: "Low", sessions: 1 })).toEqual([]);
    expect(warned({ intensity: "Low", sessions: 3 })).toEqual(["p1"]);
    expect(warned({ intensity: "Low", sessions: 5, keepAbove: 75 })).toEqual([]);
  });

  // Given a starter the server says sits out, and a day with no costs,
  // when the warning is read,
  // then no one is warned: he will not train, and nothing is guessed without costs.
  it("leaves out who sits out, and says nothing without costs", () => {
    const sitting = { ...EXTRA, sitOut: [{ playerId: "p1", reason: "injured" }] };
    expect(warned({ intensity: "High", sessions: 3, extra: sitting })).toEqual([]);
    const { costs: _costs, ...noCosts } = EXTRA;
    expect(warned({ intensity: "High", sessions: 3, extra: noCosts })).toEqual([]);
  });
});

describe("focus", () => {
  const club = myClub();
  const plan = {
    ...club.trainingPlan,
    focus: "Physical" as const,
    groups: [{ id: "g1", name: "Wings", focus: "Technical" as const, player_ids: ["p2"] }],
  };
  const withAttributes = (id: string, values: Partial<SquadPlayerView["attributes"]>) =>
    squadPlayer({ id, attributes: { ...squadPlayer().attributes, ...values } });

  // Given players with a focus of their own, in a group, and in neither,
  // when their focus is read,
  // then it is the player's, then the group's, then the club's.
  it("is the player's, else the group's, else the club's", () => {
    expect(focusOf(squadPlayer({ id: "p1", trainingFocus: "Tactical" }), plan)).toBe("Tactical");
    expect(focusOf(squadPlayer({ id: "p2" }), plan)).toBe("Technical");
    expect(focusOf(squadPlayer({ id: "p3" }), plan)).toBe("Physical");
  });

  // Given a player whose Physical attributes are all 99, and one with stamina at 98,
  // when the card looks for full focuses (R12-F),
  // then only the first is full.
  it("is full when every attribute it trains is at 99", () => {
    const full = withAttributes("p1", { pace: 99, stamina: 99, strength: 99, agility: 99 });
    const room = withAttributes("p3", { pace: 99, stamina: 98, strength: 99, agility: 99 });
    expect(focusFull([full, room], ["p1", "p3"], plan).map((p) => p.id)).toEqual(["p1"]);
    expect(focusFull([full], [], plan)).toEqual([]);
  });

  // Given a player in the Technical group whose split attributes are 0 (he has none of them)
  // and whose other Technical attributes are 99,
  // when the card looks for full focuses,
  // then he is full: training skips the attributes he does not have.
  it("skips the attributes a player does not have", () => {
    const player = withAttributes("p2", {
      passing: 99,
      shooting: 99,
      dribbling: 99,
      long_passing: 0,
      crossing: 0,
      curve: 0,
      free_kick: 0,
      long_shots: 0,
      first_touch: 0,
    });
    expect(focusFull([player], ["p2"], plan).map((p) => p.id)).toEqual(["p2"]);
  });
});

describe("namesOf and stopReasonKey", () => {
  // Given five players, then a reason this build does not know,
  // when the warning's names and a reason's key are read,
  // then three names and "2 more", and the plain key.
  it("lists three names and reads unknown reasons plainly", () => {
    const five = ["A", "B", "C", "D", "E"].map((name, i) =>
      squadPlayer({ id: `p${i}`, matchName: name }),
    );
    expect(namesOf(five)).toEqual({ names: "A, B, C", more: 2 });
    expect(stopReasonKey("keepAbove")).toBe("online.training.extra.reason.keepAbove");
    expect(stopReasonKey("sold")).toBe("online.training.extra.reason.other");
  });
});
