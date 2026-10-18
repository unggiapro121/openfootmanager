import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TeamTacticsEditor } from "./TeamTacticsEditor";
import { emptyPlayer } from "./helpers";
import type { PlayerDef, TeamTacticsDef } from "./types";

const fetchTacticsBlueprint = vi.fn();
vi.mock("../../../services/worldEditorService", () => ({
  fetchTacticsBlueprint: (style: string) => fetchTacticsBlueprint(style),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number> | string) => {
      if (key === "worldEditor.tactics.elevenProgress" && typeof params === "object") {
        return `${params.count}/${params.total}`;
      }
      if (key === "worldEditor.tactics.slotPlayer" && typeof params === "object") {
        return `player ${params.position}`;
      }
      if (key === "worldEditor.tactics.slotRole" && typeof params === "object") {
        return `role ${params.position}`;
      }
      if (key.startsWith("common.posAbbr.") && typeof params === "object") {
        return String(params.defaultValue ?? key);
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));

function player(id: string, position: PlayerDef["position"]): PlayerDef {
  return { ...emptyPlayer(), id, name: id, club: "arsenal", position };
}

const squad = [player("raya", "Goalkeeper"), player("saliba", "CenterBack")];

function renderEditor(tactics: TeamTacticsDef | null, onChange = vi.fn()) {
  render(
    <TeamTacticsEditor
      tactics={tactics}
      clubPlayers={squad}
      playStyle="Possession"
      onChange={onChange}
      onError={vi.fn()}
    />,
  );
  return onChange;
}

async function choose(combobox: HTMLElement, option: string) {
  await act(async () => {
    fireEvent.click(combobox);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: option }));
  });
}

describe("TeamTacticsEditor", () => {
  // Given a club with no tactics, when a formation is chosen, then the club
  // gets that shape and nothing else it did not choose.
  it("sets a formation on a club with none", async () => {
    const onChange = renderEditor(null);
    expect(screen.getByText("worldEditor.tactics.needFormation")).toBeInTheDocument();

    await choose(screen.getByRole("combobox", { name: "tactics.formation" }), "4-3-3");

    expect(onChange).toHaveBeenLastCalledWith({ formation: "4-3-3" });
  });

  // Given a shape, when the keeper slot is given a player, then he is slot 0
  // of the eleven and the pitch counts one of eleven picked.
  it("puts a chosen player in his slot", async () => {
    const onChange = renderEditor({ formation: "4-4-2" });
    expect(screen.getByText("0/11")).toBeInTheDocument();

    await choose(screen.getByRole("combobox", { name: "player GK" }), "GK · raya");

    const saved = onChange.mock.lastCall?.[0] as TeamTacticsDef;
    expect(saved.startingXi?.[0]).toBe("raya");
    expect(saved.startingXi).toHaveLength(11);
  });

  // Given a starter who has since left the club, then his slot still names
  // him, flagged, rather than showing an empty slot.
  it("flags a starter who is no longer in the club", () => {
    renderEditor({ formation: "4-4-2", startingXi: ["palmer"] });

    expect(screen.getByRole("combobox", { name: "player GK" })).toHaveTextContent(
      "worldEditor.tactics.notInClub",
    );
  });

  // Given default phase settings, when custom settings are switched on, then
  // they start from the play style's own, asked of the backend.
  it("starts custom phase settings from the play style's own", async () => {
    const blueprint = { build_up_style: "Short", pressing_intensity: "Aggressive" };
    fetchTacticsBlueprint.mockResolvedValueOnce(blueprint);
    const onChange = renderEditor(null);
    expect(screen.getByText("worldEditor.tactics.phaseFromStyle")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ phase: blueprint }));
    expect(fetchTacticsBlueprint).toHaveBeenCalledWith("Possession");
  });
});
