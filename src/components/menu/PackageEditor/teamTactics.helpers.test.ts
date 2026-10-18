import { describe, expect, it } from "vitest";

import {
  compactTactics,
  filledStarters,
  slotPositions,
  withFormation,
  withMatchRole,
  withRole,
  withStarter,
} from "./teamTactics.helpers";

describe("teamTactics helpers", () => {
  // Given a shape, then its slots are listed in slot order, keeper first, as
  // the game's own pitch lists them.
  it("lists a formation's slots keeper first", () => {
    const slots = slotPositions("4-4-2");

    expect(slots).toHaveLength(11);
    expect(slots[0]).toBe("Goalkeeper");
    expect(slots.slice(1, 5)).toEqual(["LeftBack", "CenterBack", "CenterBack", "RightBack"]);
  });

  // Given an eleven in 4-4-2, when the shape changes to 3-5-2, then the side
  // keeps its slots by index and drops a role the new slot does not admit.
  it("keeps the eleven by slot and drops roles a new slot does not admit", () => {
    const tactics = {
      formation: "4-4-2",
      startingXi: ["gk", "lb", "cb1", "cb2", "rb", "lm", "cm1", "cm2", "rm", "st1", "st2"],
      playerRoles: { lb: "AttackingFB" as const, st1: "Poacher" as const },
    };

    const next = withFormation(tactics, "3-5-2");

    expect(next.formation).toBe("3-5-2");
    expect(next.startingXi).toEqual(tactics.startingXi);
    // Slot 1 is a centre-back in 3-5-2: a full-back role no longer fits.
    expect(next.playerRoles).toEqual({ st1: "Poacher" });
  });

  // Given tactics with a shape, when the shape is set back to automatic, then
  // the eleven and roles, which only mean something in a shape, go with it.
  it("drops the eleven and roles when the shape goes back to automatic", () => {
    const next = withFormation(
      { formation: "4-3-3", startingXi: ["gk"], playerRoles: { gk: "SweeperKeeper" } },
      null,
    );

    expect(next).toEqual({});
  });

  // Given a player already in the side, when he is put in another slot, then
  // he moves there and that slot's player takes his old one.
  it("swaps a starter moved to an occupied slot", () => {
    const tactics = { formation: "4-4-2", startingXi: ["gk", "a", "b"] };

    const next = withStarter(tactics, 2, "a");

    expect(next.startingXi?.slice(0, 3)).toEqual(["gk", "b", "a"]);
    expect(next.startingXi).toHaveLength(11);
  });

  // Given a starter with a role, when his slot is cleared, then his role goes
  // too: roles are set per slot in the editor.
  it("clears a removed starter's role", () => {
    const tactics = {
      formation: "4-4-2",
      startingXi: ["gk", "a"],
      playerRoles: { a: "AttackingFB" as const },
    };

    const next = withStarter(tactics, 1, "");

    expect(filledStarters(next)).toBe(1);
    expect(next.playerRoles).toEqual({});
  });

  // Given a starter, when his role is set to Standard, then it is left out,
  // since Standard is what no role means.
  it("leaves the standard role out", () => {
    const tactics = {
      formation: "4-4-2",
      startingXi: ["gk"],
      playerRoles: { gk: "SweeperKeeper" as const },
    };

    expect(withRole(tactics, "gk", "Standard").playerRoles).toEqual({});
    expect(withRole(tactics, "gk", "BallPlayingKeeper").playerRoles).toEqual({
      gk: "BallPlayingKeeper",
    });
  });

  // Given tactics with nothing chosen, when compacted for saving, then the
  // club is written with no `tactics` at all; with a captain only, only that.
  it("compacts empty tactics away", () => {
    expect(compactTactics({ startingXi: ["", ""], playerRoles: {} })).toBeUndefined();

    const captainOnly = withMatchRole({}, "captain", "a");
    expect(compactTactics(captainOnly)).toEqual({
      matchRoles: {
        captain: "a",
        vice_captain: null,
        penalty_taker: null,
        free_kick_taker: null,
        corner_taker: null,
      },
    });
    expect(compactTactics(withMatchRole(captainOnly, "captain", null))).toBeUndefined();
  });
});
