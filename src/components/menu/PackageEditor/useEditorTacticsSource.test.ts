import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { emptyTeam } from "./helpers";
import type { TeamDef } from "./types";
import { useEditorTacticsSource } from "./useEditorTacticsSource";

const previewPackageClub = vi.fn();
vi.mock("../../../services/worldEditorService", () => ({
  previewPackageClub: (...args: unknown[]) => previewPackageClub(...args),
}));

const preview = {
  team: {
    id: "arsenal",
    formation: "4-2-3-1",
    play_style: "Possession",
    player_roles: { rice: "BoxToBox" },
    match_roles: null,
    tactics_phase: { build_up_style: "Short", pressing_intensity: "Medium" },
  },
  players: [{ id: "raya" }],
  position_ratings: {},
};

async function sourceFor(team: Partial<TeamDef>) {
  previewPackageClub.mockResolvedValue(preview);
  const onTacticsChange = vi.fn();
  const onPlayStyleChange = vi.fn();
  const { result } = renderHook(() =>
    useEditorTacticsSource({
      team: { ...emptyTeam(), id: "arsenal", playStyle: "Possession", ...team },
      clubPlayers: [],
      baseYear: 2026,
      onTacticsChange,
      onPlayStyleChange,
      onError: vi.fn(),
    }),
  );
  await waitFor(() => expect(result.current).not.toBeNull());
  const source = result.current;
  if (!source) throw new Error("expected a source");
  return { source, onTacticsChange, onPlayStyleChange };
}

describe("useEditorTacticsSource", () => {
  // Given a club without tactics, when a side is picked on the board, then it
  // is saved with the shape it was picked in, since slots follow the shape.
  it("pins the shape with a picked side", async () => {
    const { source, onTacticsChange } = await sourceFor({});

    await source.setStartingXi(["raya"]);

    expect(onTacticsChange).toHaveBeenCalledWith({ formation: "4-2-3-1", startingXi: ["raya"] });
  });

  // Given the club's own phase settings, when one setting is changed, then the
  // saved settings are the club's own with that one changed.
  it("saves a phase change over the club's own settings", async () => {
    const { source, onTacticsChange } = await sourceFor({});

    await source.setTacticsPhase({ pressing_intensity: "Aggressive" });

    expect(onTacticsChange).toHaveBeenCalledWith({
      phase: { build_up_style: "Short", pressing_intensity: "Aggressive" },
    });
  });

  // Given a player the club gave a role, when the author sets him to
  // Standard, then Standard is saved: it has to override the club's choice.
  it("keeps a Standard role the author chose", async () => {
    const { source, onTacticsChange } = await sourceFor({});

    await source.setPlayerRole("rice", "Standard");

    expect(onTacticsChange).toHaveBeenCalledWith({ playerRoles: { rice: "Standard" } });
  });

  // Given the board's play style picker, when a style is chosen, then it is
  // the club's play style that changes, not its tactics.
  it("changes the club's play style, not its tactics", async () => {
    const { source, onTacticsChange, onPlayStyleChange } = await sourceFor({});

    await source.setPlayStyle("Counter");

    expect(onPlayStyleChange).toHaveBeenCalledWith("Counter");
    expect(onTacticsChange).not.toHaveBeenCalled();
  });
});
