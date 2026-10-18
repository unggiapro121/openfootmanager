import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TacticsBoardSource } from "../../tactics/tacticsBoardSource";
import { TeamTacticsEditor } from "./TeamTacticsEditor";
import { emptyTeam } from "./helpers";
import type { TeamDef } from "./types";

const previewPackageClub = vi.fn();
vi.mock("../../../services/worldEditorService", () => ({
  previewPackageClub: (...args: unknown[]) => previewPackageClub(...args),
}));

// The board itself is the game's, tested with the Tactics tab; here it only has
// to receive the club the editor built.
vi.mock("../../tactics/TacticsBoard", () => ({
  default: ({ source }: { source: TacticsBoardSource }) => (
    <p>{`board ${source.team?.formation} with ${source.roster.length} players`}</p>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.formation ? `${key} ${params.formation}` : key,
    i18n: { language: "en" },
  }),
}));

function renderEditor(team: Partial<TeamDef>, onChange = vi.fn()) {
  render(
    <TeamTacticsEditor
      team={{ ...emptyTeam(), id: "arsenal", name: "Arsenal", ...team }}
      clubPlayers={[]}
      baseYear={2026}
      onChange={onChange}
      onPlayStyleChange={vi.fn()}
      onError={vi.fn()}
    />,
  );
  return onChange;
}

describe("TeamTacticsEditor", () => {
  // Given a club with no tactics, then the form says the club picks its own
  // and offers no reset.
  it("says a club without tactics picks its own", () => {
    renderEditor({});

    expect(screen.getByText("worldEditor.tactics.summaryAuto")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "worldEditor.tactics.resetToAuto" }),
    ).not.toBeInTheDocument();
  });

  // Given a club with a shape and phase settings, then the form names what is
  // set, and reset clears the club's tactics.
  it("names what is set and resets it", () => {
    const onChange = renderEditor({
      tactics: { formation: "4-3-3", phase: {} as NonNullable<TeamDef["tactics"]>["phase"] },
    });

    expect(screen.getByText("worldEditor.tactics.setFormation 4-3-3")).toBeInTheDocument();
    expect(screen.getByText("worldEditor.tactics.setPhase")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "worldEditor.tactics.resetToAuto" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  // Given the board is opened, then the club is previewed by the backend and
  // the board shows it with the authored shape over the club's own; Done
  // closes it.
  it("opens the game's tactics board on the previewed club", async () => {
    previewPackageClub.mockResolvedValueOnce({
      team: { id: "arsenal", formation: "4-2-3-1", player_roles: {}, tactics_phase: {} },
      players: [{ id: "raya" }, { id: "saliba" }],
      position_ratings: {},
    });
    renderEditor({ tactics: { formation: "3-5-2" } });

    fireEvent.click(screen.getByRole("button", { name: "worldEditor.tactics.openBoard" }));

    expect(await screen.findByText("board 3-5-2 with 2 players")).toBeInTheDocument();
    expect(previewPackageClub).toHaveBeenCalledWith(
      expect.objectContaining({ id: "arsenal" }),
      [],
      2026,
    );
    fireEvent.click(screen.getByRole("button", { name: "worldEditor.tactics.done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
