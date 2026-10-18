import { describe, expect, it } from "vitest";

import type { TeamData } from "../../../store/types";
import { boardTeam, compactTactics } from "./teamTactics.helpers";

const preview = {
  id: "arsenal",
  formation: "4-2-3-1",
  play_style: "Possession",
  starting_xi_ids: [],
  player_roles: { rice: "BoxToBox", saka: "InsideForward" },
  match_roles: {
    captain: null,
    vice_captain: null,
    penalty_taker: null,
    free_kick_taker: null,
    corner_taker: null,
  },
  tactics_phase: { build_up_style: "Short", pressing_intensity: "Medium" },
} as unknown as TeamData;

describe("boardTeam", () => {
  // Given a club with no tactics of its own, then the board shows the club as
  // it would open: its own shape, roles and phase settings, with the play
  // style the form has now.
  it("shows the club's own choices when it has no tactics", () => {
    const team = boardTeam(preview, "Counter", undefined);

    expect(team.formation).toBe("4-2-3-1");
    expect(team.play_style).toBe("Counter");
    expect(team.starting_xi_ids).toEqual([]);
    expect(team.player_roles).toEqual(preview.player_roles);
    expect(team.tactics_phase).toEqual(preview.tactics_phase);
  });

  // Given authored tactics, then each part the author set replaces the club's
  // own, and a role the author set wins over the one the club picked.
  it("lays the authored tactics over the club's own", () => {
    const phase = { build_up_style: "Long" } as TeamData["tactics_phase"];
    const team = boardTeam(preview, "Possession", {
      formation: "3-5-2",
      startingXi: ["raya"],
      playerRoles: { rice: "Standard" },
      phase,
    });

    expect(team.formation).toBe("3-5-2");
    expect(team.starting_xi_ids).toEqual(["raya"]);
    expect(team.player_roles).toEqual({ rice: "Standard", saka: "InsideForward" });
    expect(team.tactics_phase).toBe(phase);
  });
});

describe("compactTactics", () => {
  // Given tactics with nothing chosen, when compacted for saving, then the
  // club is written with no `tactics` at all; with a captain only, only that.
  it("compacts empty tactics away", () => {
    expect(compactTactics({ startingXi: [], playerRoles: {} })).toBeUndefined();

    const roles = {
      captain: "rice",
      vice_captain: null,
      penalty_taker: null,
      free_kick_taker: null,
      corner_taker: null,
    };
    expect(compactTactics({ matchRoles: roles })).toEqual({ matchRoles: roles });
    expect(compactTactics({ matchRoles: { ...roles, captain: null } })).toBeUndefined();
  });
});
