import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useGameStore } from "../../store/gameStore";

import PlayerProfileRecentMatchesCard, {
  type PlayerRecentMatchEntry,
} from "./PlayerProfileRecentMatchesCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function match(fixtureId: string, rating: number, minutes: number): PlayerRecentMatchEntry {
  return {
    fixture_id: fixtureId,
    date: "2026-09-01",
    competition: "League",
    matchday: 1,
    opponent_team_id: "team2",
    opponent_name: `Opponent ${fixtureId}`,
    team_goals: 1,
    opponent_goals: 0,
    minutes_played: minutes,
    goals: 0,
    assists: 0,
    shots: 0,
    shots_on_target: 0,
    rating,
  };
}

const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

describe("PlayerProfileRecentMatchesCard", () => {
  it("shows a rated match's rating", () => {
    render(<PlayerProfileRecentMatchesCard matches={[match("f1", 7.2, 90)]} t={t} />);

    expect(screen.getByText("7.2")).toBeInTheDocument();
  });

  it("shows a cameo too short to be rated as a dash, not as 0.0", () => {
    render(<PlayerProfileRecentMatchesCard matches={[match("f1", 0, 5)]} t={t} />);

    expect(screen.queryByText("0.0")).not.toBeInTheDocument();
    expect(screen.getByText("–")).toBeInTheDocument();
  });

  it("leaves unrated cameos out of the rating trend", () => {
    render(
      <PlayerProfileRecentMatchesCard
        matches={[match("f1", 7.2, 90), match("f2", 0, 5), match("f3", 0, 4)]}
        t={t}
      />,
    );

    // One rated match is not a trend: the chart shows its empty state.
    expect(screen.getByText("common.noChartData")).toBeInTheDocument();
  });

  // Given a recent match, when its score is pressed, then its match details open.
  it("opens a recent match's details from its score", () => {
    useGameStore.setState({ matchDetailFixtureId: null });
    render(<PlayerProfileRecentMatchesCard matches={[match("f1", 7.2, 90)]} t={t} />);

    fireEvent.click(screen.getByRole("button", { name: /match\.viewMatchDetails/ }));

    expect(useGameStore.getState().matchDetailFixtureId).toBe("f1");
  });
});
