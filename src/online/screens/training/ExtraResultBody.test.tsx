import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { myClub, squadPlayer, trainingDayView } from "../../../test-utils/onlineTestKit";
import { ExtraResultBody } from "./ExtraResultBody";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
  }),
}));

const NOTE = "online.training.extra.matchGrowthNote";

function renderWith(matchXp: number | undefined) {
  const player = squadPlayer({ id: "p1", matchXp });
  const outcome = {
    result: {
      day: 3,
      intensity: "Medium",
      held: 2,
      firstN: 1,
      lastN: 2,
      players: [{ playerId: "p1", conditionBefore: 90, conditionAfter: 80, gains: 1, sessions: 2 }],
      trainingDay: trainingDayView(),
    },
    before: new Map(),
  };
  render(<ExtraResultBody club={myClub({ players: [player] })} outcome={outcome} floor={40} />);
}

describe("the extra session's result in a season with match growth (C-22b, N5)", () => {
  // Given a season with match growth (the squad's players carry an Experience bar),
  // when an extra session's result shows,
  // then one fixed line says part of the progress is banked into Experience, paid in matches,
  // with no figure.
  it("says part of the progress goes to the Experience bar", () => {
    renderWith(40);
    expect(screen.getByText(NOTE)).toBeVisible();
  });

  // Given a season without match growth (no bar),
  // when the result shows,
  // then there is no such line.
  it("says nothing of it without match growth", () => {
    renderWith(undefined);
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});
