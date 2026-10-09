import { describe, expect, it } from "vitest";

import { likelyXi, likelyXiAverageOvr } from "./playerOvr";

const squad = (...ovrs: number[]) => ovrs.map((ovr, index) => ({ id: `p${index}`, ovr }));

describe("likelyXi", () => {
  // Given fourteen players, then the eleven best start, best first.
  it("picks the eleven best players, best first", () => {
    const players = squad(40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53);

    const xi = likelyXi(players);

    expect(xi).toHaveLength(11);
    expect(xi.map((player) => player.ovr)).toEqual([53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43]);
  });

  // Given fewer than eleven players, then they all start.
  it("starts everyone a short squad has", () => {
    expect(likelyXi(squad(60, 70))).toHaveLength(2);
  });
});

describe("likelyXiAverageOvr", () => {
  // Given eleven regulars and weak reserves, then the reserves who would not
  // start do not drag the average down.
  it("averages the likely starting eleven only", () => {
    const players = squad(80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 40, 45, 50);

    expect(likelyXiAverageOvr(players)).toBe(80);
  });

  // Given no players, then the average is zero.
  it("is zero for a club with nobody", () => {
    expect(likelyXiAverageOvr([])).toBe(0);
  });

  // Given a fractional average, then it is rounded.
  it("rounds the average", () => {
    expect(likelyXiAverageOvr(squad(70, 71))).toBe(71);
  });
});
