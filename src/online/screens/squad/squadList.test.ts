import { describe, expect, it } from "vitest";
import { squadPlayer } from "../../../test-utils/onlineTestKit";
import { byLine, matchesFilter, NO_FILTER, sortedBy } from "./squadList";

const gk = squadPlayer({
  id: "gk",
  fullName: "Gia Khánh",
  matchName: "G. Khánh",
  position: "Goalkeeper",
  ovr: 60,
  age: 30,
  condition: 90,
});
const cb = squadPlayer({
  id: "cb",
  fullName: "Cao Bằng",
  matchName: "C. Bằng",
  position: "Defender",
  ovr: 70,
  age: 25,
  condition: 40,
});
const st = squadPlayer({
  id: "st",
  fullName: "Sơn Tùng",
  matchName: "S. Tùng",
  position: "Forward",
  ovr: 66,
  age: 21,
  condition: 100,
  injury: { name: "common.injuries.strain", daysRemaining: 3 },
});
const all = [st, gk, cb];
const eleven = new Set(["gk", "cb"]);

describe("the squad list", () => {
  // Given a squad of a forward, a keeper and a defender,
  // when it is read with no column chosen,
  // then it is by line, keeper first, then by overall.
  it("reads by line by default", () => {
    expect(byLine(all).map((p) => p.id)).toEqual(["gk", "cb", "st"]);
    expect(sortedBy(all, { key: null, dir: "asc" }).map((p) => p.id)).toEqual(["gk", "cb", "st"]);
  });

  // Given a column and a direction,
  // when the squad is sorted by condition, then by name descending,
  // then each order is the column's, ascending or descending.
  it("sorts by a column in either direction", () => {
    expect(sortedBy(all, { key: "condition", dir: "asc" }).map((p) => p.id)).toEqual([
      "cb",
      "gk",
      "st",
    ]);
    expect(sortedBy(all, { key: "name", dir: "desc" }).map((p) => p.id)).toEqual([
      "st",
      "gk",
      "cb",
    ]);
    expect(sortedBy(all, { key: "age", dir: "asc" }).map((p) => p.id)).toEqual(["st", "cb", "gk"]);
  });

  // Given a squad and the first eleven,
  // when it is filtered by name (either of his names, any case), line, and scope,
  // then only the players that every part of the filter lets through remain.
  it("filters by name, line and scope", () => {
    const shown = (filter: Partial<typeof NO_FILTER>) =>
      all.filter((p) => matchesFilter(p, { ...NO_FILTER, ...filter }, eleven)).map((p) => p.id);

    expect(shown({})).toEqual(["st", "gk", "cb"]);
    expect(shown({ search: "  tùNG " })).toEqual(["st"]);
    expect(shown({ search: "khánh" })).toEqual(["gk"]);
    expect(shown({ group: "Defender" })).toEqual(["cb"]);
    expect(shown({ scope: "xi" })).toEqual(["gk", "cb"]);
    expect(shown({ scope: "bench" })).toEqual(["st"]);
    expect(shown({ scope: "injured" })).toEqual(["st"]);
    expect(shown({ scope: "xi", group: "Forward" })).toEqual([]);
  });
});
