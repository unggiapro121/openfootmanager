import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerPositionBadges } from "./PlayerPositionBadges";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Stand-in translations: abbreviations and full names from the defaults.
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
    i18n: { language: "en" },
  }),
}));

describe("PlayerPositionBadges", () => {
  /**
   * Given an attacking midfielder who also covers central and left midfield,
   * then all three show abbreviated, each with its full name on hover.
   */
  it("abbreviates the natural position and every one he can cover", () => {
    render(
      <PlayerPositionBadges
        primaryPosition="AttackingMidfielder"
        alternatePositions={["CentralMidfielder", "LeftMidfielder"]}
      />,
    );

    expect(screen.getByTitle("Attacking Midfielder")).toHaveTextContent("AM");
    expect(screen.getByTitle("Central Midfielder")).toHaveTextContent("CM");
    expect(screen.getByTitle("Left Midfielder")).toHaveTextContent("LM");
  });

  /** Given an alternate list that repeats the natural position, then it shows once. */
  it("does not repeat the natural position among the alternates", () => {
    render(
      <PlayerPositionBadges
        primaryPosition="Striker"
        alternatePositions={["Striker", "RightWinger"]}
      />,
    );

    expect(screen.getAllByTitle("Striker")).toHaveLength(1);
    expect(screen.getByTitle("Right Winger")).toBeInTheDocument();
  });
});
