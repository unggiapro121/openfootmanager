import { describe, expect, it } from "vitest";
import { squadPlayer } from "../../../test-utils/onlineTestKit";
import {
  inOwnOrder,
  nextSort,
  PHONE_DEFAULT_SORT,
  phoneSections,
  scopeCounts,
} from "./phoneSquadList";
import { NO_FILTER } from "./squadList";

const players = [
  squadPlayer({ id: "a", position: "Goalkeeper", matchName: "An" }),
  squadPlayer({ id: "b", position: "Defender", matchName: "Bình" }),
  squadPlayer({
    id: "c",
    position: "Defender",
    matchName: "Cường",
    injury: { name: "Knee", daysRemaining: 3 },
  }),
];
const eleven = new Set(["a", "b"]);

describe("scopeCounts", () => {
  // Given three players, two in the eleven and one hurt, and the defenders chosen,
  // when the status tabs are counted,
  // then each counts the defenders it holds.
  it("counts each status under the chosen line", () => {
    expect(scopeCounts(players, { ...NO_FILTER, group: "Defender" }, eleven)).toEqual({
      all: 2,
      xi: 1,
      bench: 1,
      injured: 1,
    });
  });
});

describe("phoneSections", () => {
  // Given the squad in its own order,
  // when it is cut into parts,
  // then the eleven come first and the bench after.
  it("puts the eleven before the bench", () => {
    expect(
      phoneSections(players, eleven, true).map((part) => [part.id, part.players.map((p) => p.id)]),
    ).toEqual([
      ["xi", ["a", "b"]],
      ["bench", ["c"]],
    ]);
  });

  // Given a sorted list, or nobody at all,
  // when it is cut into parts,
  // then it is one part, or none.
  it("keeps a sorted list whole and an empty one empty", () => {
    expect(phoneSections(players, eleven, false).map((part) => part.id)).toEqual(["all"]);
    expect(phoneSections([], eleven, false)).toEqual([]);
    expect(phoneSections([players[2]], eleven, true).map((part) => part.id)).toEqual(["bench"]);
  });
});

describe("nextSort", () => {
  // Given the list in its own order,
  // when a heading is tapped, then the same one again,
  // then its column starts best first, then turns round; the line heading brings the order back.
  it("starts a column best first and turns it round on a second tap", () => {
    const byOvr = nextSort(PHONE_DEFAULT_SORT, "ovr");
    expect(byOvr).toEqual({ key: "ovr", dir: "desc" });
    expect(nextSort(byOvr, "ovr")).toEqual({ key: "ovr", dir: "asc" });
    expect(nextSort(byOvr, "style")).toEqual({ key: "style", dir: "asc" });
    expect(inOwnOrder(nextSort(byOvr, "pos"))).toBe(true);
    expect(inOwnOrder(nextSort(PHONE_DEFAULT_SORT, "pos"))).toBe(false);
  });
});
