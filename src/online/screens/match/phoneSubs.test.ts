import { describe, expect, it } from "vitest";
import type { EnginePlayerData } from "../../../components/match/types";
import type { SentCommand } from "../../api";
import { benchForSlot, substitutionsInFlight, suggestionsStillOpen } from "./phoneSubs";

const line = (commandId: string, command: SentCommand["command"], status = "pending") =>
  ({ commandId, command, status, sentAt: "2026-11-03T10:00:00Z" }) as SentCommand;

const sub = (off: string, on: string) => ({
  Substitute: { side: "Home" as const, player_off_id: off, player_on_id: on },
});

function player(id: string, overrides: Partial<EnginePlayerData> = {}): EnginePlayerData {
  return {
    id,
    name: id,
    position: "Midfielder",
    ovr: 60,
    condition: 80,
    ...overrides,
  } as EnginePlayerData;
}

describe("substitutionsInFlight", () => {
  // Given a substitution waiting, one the match has decided, one already marked applied and a
  // change of shape,
  // when the substitutions in flight are read,
  // then only the waiting one is.
  it("keeps only the substitutions the match has not decided", () => {
    const sent = [
      line("c1", sub("h9", "hs1")),
      line("c2", sub("h8", "hs2")),
      line("c3", sub("h7", "hs3"), "applied"),
      line("c4", { ChangeFormation: { side: "Home", formation: "4-3-3" } }),
    ];
    expect(substitutionsInFlight(sent, { c2: "refused" })).toEqual([{ offId: "h9", onId: "hs1" }]);
  });
});

describe("benchForSlot", () => {
  // Given a bench of a strong stranger to the slot, an adapted player and two at home there,
  // when they are ordered for the slot,
  // then the two at home come first, the fresher-and-stronger of them ahead, then the adapted,
  // then the stranger, each with his rating in the slot.
  it("puts the players at home in the slot first", () => {
    const rated = (fit: "Natural" | "Adapted" | "Unfamiliar", ovr: number) => ({
      position_ratings: [{ position: "CentralMidfielder", fit, ovr }],
    });
    const bench = [
      player("stranger", rated("Unfamiliar", 75)),
      player("adapted", rated("Adapted", 70)),
      player("tired", { ...rated("Natural", 66), condition: 40 }),
      player("fresh", { ...rated("Natural", 64), condition: 95 }),
    ] as EnginePlayerData[];

    const ordered = benchForSlot(bench, "CentralMidfielder");
    expect(ordered.map((candidate) => candidate.player.id)).toEqual([
      "fresh",
      "tired",
      "adapted",
      "stranger",
    ]);
    expect(ordered[0]).toMatchObject({ fit: "Natural", ovr: 64 });
  });

  // Given a bench player the match did not rate,
  // when he is ordered for a slot,
  // then he comes last, with his own overall and no familiarity.
  it("puts an unrated player last", () => {
    const ordered = benchForSlot(
      [
        player("unrated", { ovr: 80 }),
        player("rated", {
          position_ratings: [{ position: "Striker", fit: "Unfamiliar", ovr: 50 }],
        } as Partial<EnginePlayerData>),
      ],
      "Striker",
    );
    expect(ordered.map((candidate) => [candidate.player.id, candidate.fit, candidate.ovr])).toEqual(
      [
        ["rated", "Unfamiliar", 50],
        ["unrated", null, 80],
      ],
    );
  });
});

describe("suggestionsStillOpen", () => {
  const rec = (offId: string, onId: string) => ({ offId, onId, reasons: ["low-fitness" as const] });
  const bench = [player("b1"), player("b2"), player("b3")];

  // Given four suggestions: one queued as suggested, one whose player off already has another
  // replacement, one whose player on was already sent on, and one free,
  // when the open ones are read,
  // then the queued one and the free one are left.
  it("drops the suggestions that clash with a chosen change", () => {
    const queue = [
      { offId: "p1", onId: "b1" },
      { offId: "p2", onId: "b2" },
    ];
    const changes = [{ offId: "p9", onId: "b3" }, ...queue];
    const open = suggestionsStillOpen(
      [rec("p1", "b1"), rec("p2", "b3"), rec("p3", "b3"), rec("p4", "b9")],
      queue,
      changes,
      [...bench, player("b9")],
    );
    expect(open.map((one) => one.offId)).toEqual(["p1", "p4"]);
  });

  // Given a suggestion of a player no longer on the bench,
  // when the open ones are read,
  // then it is dropped.
  it("drops a suggestion of a player who has left the bench", () => {
    expect(suggestionsStillOpen([rec("p1", "gone")], [], [], bench)).toEqual([]);
  });
});
