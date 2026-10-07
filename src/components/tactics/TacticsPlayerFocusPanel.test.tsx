import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createPlayer } from "../../test-utils/factories";
import TacticsPlayerFocusPanel from "./TacticsPlayerFocusPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: "en" },
  }),
}));

describe("TacticsPlayerFocusPanel", () => {
  /**
   * Given two midfielders being compared, then each summary lists his natural
   * position and the ones he can cover, abbreviated.
   */
  it("shows every position each compared player can play", () => {
    const selected = createPlayer({
      id: "toby",
      full_name: "Toby Goossens",
      natural_position: "AttackingMidfielder",
      alternate_positions: ["CentralMidfielder", "LeftMidfielder"],
    });
    const compared = createPlayer({
      id: "jan",
      full_name: "Jan Goossens",
      natural_position: "CentralMidfielder",
      alternate_positions: ["DefensiveMidfielder"],
    });

    render(
      <TacticsPlayerFocusPanel
        canConfirmSwap
        selectedPlayer={selected}
        comparePlayer={compared}
        onConfirmSwap={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Attacking Midfielder")).toHaveTextContent("AM");
    expect(screen.getAllByTitle("Central Midfielder").map((el) => el.textContent)).toEqual([
      "CM",
      "CM",
    ]);
    expect(screen.getByTitle("Left Midfielder")).toHaveTextContent("LM");
    expect(screen.getByTitle("Defensive Midfielder")).toHaveTextContent("DM");
  });

  /**
   * Given a selected player with traits, then they sit between his positions and
   * his age as icons, each named in its tooltip.
   */
  it("shows a player's traits as icons between positions and age", () => {
    const selected = createPlayer({
      id: "gil",
      full_name: "David Gil",
      traits: ["Tireless", "Wonderkid"],
    });

    render(
      <TacticsPlayerFocusPanel
        canConfirmSwap={false}
        selectedPlayer={selected}
        comparePlayer={null}
        onConfirmSwap={vi.fn()}
      />,
    );

    const traits = screen.getAllByRole("img", { name: /^traits\.(Tireless|Wonderkid)\.label: / });
    expect(traits).toHaveLength(2);
    expect(screen.queryByText("traits.Tireless.label")).toBeNull();
  });
});
