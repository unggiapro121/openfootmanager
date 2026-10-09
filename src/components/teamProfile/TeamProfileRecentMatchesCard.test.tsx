import { fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import { useGameStore } from "../../store/gameStore";
import type { TeamRecentMatchEntry } from "./TeamProfile.types";
import TeamProfileRecentMatchesCard from "./TeamProfileRecentMatchesCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const t = ((key: string) => key) as unknown as TFunction;

function match(): TeamRecentMatchEntry {
  return {
    fixtureId: "f7",
    date: "2026-09-01",
    competition: "League",
    matchday: 4,
    opponentTeamId: "rival",
    opponentName: "Rival FC",
    goalsFor: 3,
    goalsAgainst: 2,
    possessionPct: 51.5,
    shots: 12,
    shotsOnTarget: 6,
  };
}

describe("TeamProfileRecentMatchesCard", () => {
  // Given a recent match, then it shows the score from the team's side.
  it("shows a recent match's score from the team's side", () => {
    render(<TeamProfileRecentMatchesCard matches={[match()]} t={t} />);

    expect(screen.getByText("Rival FC")).toBeInTheDocument();
    expect(screen.getByText("3 - 2")).toBeInTheDocument();
  });

  // Given a recent match, when its score is pressed, then its match details open.
  it("opens a recent match's details from its score", () => {
    useGameStore.setState({ matchDetailFixtureId: null });
    render(<TeamProfileRecentMatchesCard matches={[match()]} t={t} />);

    fireEvent.click(screen.getByRole("button", { name: /match\.viewMatchDetails/ }));

    expect(useGameStore.getState().matchDetailFixtureId).toBe("f7");
  });
});
