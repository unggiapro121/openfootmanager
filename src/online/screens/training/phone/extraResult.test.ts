import { describe, expect, it } from "vitest";
import { squadPlayer } from "../../../../test-utils/onlineTestKit";
import type { ExtraPlayerLine } from "../../../api";
import { namedGains, pressTotals, unimproved } from "./extraResult";

const BASE = squadPlayer().attributes;

function line(overrides: Partial<ExtraPlayerLine> = {}): ExtraPlayerLine {
  return {
    playerId: "p1",
    conditionBefore: 80,
    conditionAfter: 74,
    gains: 0,
    sessions: 2,
    ...overrides,
  };
}

describe("pressTotals", () => {
  // Given a press where one player rose twice, one did not rise and one did not train,
  // when the totals are read,
  // then they count two attributes risen, by one player of the three chosen.
  it("counts the attributes risen, the players who rose and those chosen", () => {
    const totals = pressTotals([
      line({ playerId: "p1", gains: 2 }),
      line({ playerId: "p2", gains: 0 }),
      line({ playerId: "p3", gains: 0, sessions: 0, stoppedBy: "keepAbove" }),
    ]);

    expect(totals).toEqual({ gains: 2, improved: 1, players: 3 });
  });
});

describe("namedGains", () => {
  // Given a player's attributes before a press and after it, two of them one higher,
  // when the server says he gained two,
  // then both attributes are named, each by one.
  it("names the attributes that rose when they account for every gain", () => {
    const after = { ...BASE, tackling: BASE.tackling + 1, pace: BASE.pace + 1 };

    expect(namedGains(BASE, after, 2)).toEqual([
      { attribute: "pace", by: 1 },
      { attribute: "tackling", by: 1 },
    ]);
  });

  // Given the squad not yet read again after the press,
  // when the server says he gained one,
  // then no names are given, so the sheet falls back to the count.
  it("gives nothing when the reads do not account for the gains", () => {
    expect(namedGains(BASE, BASE, 1)).toBeNull();
    expect(namedGains(undefined, BASE, 1)).toBeNull();
  });

  // Given a player who also lost an attribute between the reads (an injury, an age step),
  // when his rises still match the server's count,
  // then only the rises are named.
  it("ignores attributes that fell", () => {
    const after = { ...BASE, vision: BASE.vision + 1, pace: BASE.pace - 1 };

    expect(namedGains(BASE, after, 1)).toEqual([{ attribute: "vision", by: 1 }]);
  });
});

describe("unimproved", () => {
  // Given players who trained without rising and players who never trained,
  // when they are grouped for the sheet,
  // then those who trained come together, and the others by why they stopped.
  it("groups the players who did not rise by what happened to them", () => {
    const groups = unimproved([
      line({ playerId: "p1", gains: 1 }),
      line({ playerId: "p2" }),
      line({ playerId: "p3", sessions: 0, stoppedBy: "keepAbove" }),
      line({ playerId: "p4" }),
      line({ playerId: "p5", sessions: 0 }),
    ]);

    expect(groups).toEqual([
      { kind: "trained", playerIds: ["p2", "p4"] },
      { kind: "keepAbove", playerIds: ["p3"] },
      { kind: "other", playerIds: ["p5"] },
    ]);
  });
});
