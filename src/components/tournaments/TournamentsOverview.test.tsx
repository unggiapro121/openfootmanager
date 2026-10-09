import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TournamentsOverview from "./TournamentsOverview";
import type { TournamentsTeamLookup } from "./teamLookup";
import type { LeagueData, StandingData } from "../../store/gameStore";

vi.mock("react-i18next", async () => {
  const { useRef } = await import("react");
  return {
    useTranslation: () => {
      useRef(null);
      return { t: (key: string) => key };
    },
  };
});

const teams: TournamentsTeamLookup = {
  userTeamId: "team-1",
  isClubTeam: () => true,
  resolveTeamName: (id) => `Name of ${id}`,
  onSelectTeam: vi.fn(),
};

function standing(teamId: string): StandingData {
  return {
    team_id: teamId,
    played: 4,
    won: 2,
    drawn: 1,
    lost: 1,
    goals_for: 7,
    goals_against: 5,
    points: 7,
  };
}

const group = {
  id: "group-a",
  name: "A",
  standings: [standing("team-2")],
} as unknown as NonNullable<LeagueData["groups"]>[number];

const round = {
  id: "round-1",
  name: "Final",
  completed: false,
} as unknown as NonNullable<LeagueData["knockout_rounds"]>[number];

function renderOverview(props: Partial<React.ComponentProps<typeof TournamentsOverview>> = {}) {
  return render(
    <TournamentsOverview
      standings={[standing("team-1")]}
      groups={[]}
      knockoutRounds={[]}
      isKnockout={false}
      isPreseason={false}
      leaders={null}
      teams={teams}
      {...props}
    />,
  );
}

// The summary panel picks one of four shapes, in a fixed order. The order is a
// chain of conditionals that is easy to reshuffle without noticing, so each
// step of the precedence is pinned here — as it is for TournamentsStandingsView.
describe("TournamentsOverview", () => {
  it("shows a league its compact table", () => {
    renderOverview();

    expect(screen.getByTestId("tournaments-overview-standing-team-1")).toBeInTheDocument();
  });

  // The compact table drops goals for and against; the standings view keeps them.
  it("leaves the goal columns to the full table", () => {
    renderOverview();

    expect(screen.getByText("common.played")).toBeInTheDocument();
    expect(screen.queryByText("common.gf")).toBeNull();
  });

  it("shows a qualifying competition its groups instead of a table", () => {
    renderOverview({ groups: [group] });

    expect(screen.getByTestId("tournaments-group-group-a")).toBeInTheDocument();
    expect(screen.queryByTestId("tournaments-overview-standing-team-1")).toBeNull();
  });

  it("shows a knockout how far its rounds have got", () => {
    renderOverview({ isKnockout: true, knockoutRounds: [round] });

    expect(screen.getByTestId("tournaments-round-summary-round-1")).toBeInTheDocument();
    expect(screen.getByText("tournaments.roundInProgress")).toBeInTheDocument();
  });

  // A cup whose group stage is running has no rounds yet, so the groups are
  // the only progress there is to report.
  it("falls back to a knockout's groups while it has no rounds", () => {
    renderOverview({ isKnockout: true, groups: [group] });

    expect(screen.getByTestId("tournaments-group-group-a")).toBeInTheDocument();
  });

  // Before the draw a cup has neither rounds nor groups. Rendering an empty
  // panel with no explanation is the bug this pins.
  it("explains an undrawn cup rather than showing an empty panel", () => {
    renderOverview({ isKnockout: true });

    expect(screen.getByText("season.standingsLocked")).toBeInTheDocument();
  });

  it("locks a league's table until its season starts", () => {
    renderOverview({ isPreseason: true });

    expect(screen.getByText("season.standingsLocked")).toBeInTheDocument();
    expect(screen.queryByTestId("tournaments-overview-standing-team-1")).toBeNull();
  });

  // Groups outrank the preseason lock: they are drawn before a ball is kicked.
  it("shows a qualifying competition's groups even in preseason", () => {
    renderOverview({ groups: [group], isPreseason: true });

    expect(screen.getByTestId("tournaments-group-group-a")).toBeInTheDocument();
    expect(screen.queryByText("season.standingsLocked")).toBeNull();
  });

  it("always shows the scorers panel alongside the summary", () => {
    renderOverview();

    expect(screen.getByText("tournaments.noGoals")).toBeInTheDocument();
  });

  // Given leaders for every board, then the overview shows the scorers, the
  // assists and both cards boards, each with its own title.
  it("shows the goal, assist and card leaders", () => {
    const entry = (playerId: string, value: number) => ({
      playerId,
      name: playerId,
      fullName: `Full ${playerId}`,
      teamId: "team-1",
      teamName: "Alpha FC",
      value,
    });
    renderOverview({
      leaders: {
        competitionId: "eng-1",
        goals: [entry("scorer", 9)],
        assists: [entry("creator", 6)],
        yellowCards: [entry("hacker", 4)],
        redCards: [],
      },
    });

    expect(screen.getByText("tournaments.topScorers")).toBeInTheDocument();
    expect(screen.getByText("tournaments.topAssists")).toBeInTheDocument();
    expect(screen.getByText("tournaments.mostYellowCards")).toBeInTheDocument();
    expect(screen.getByText("tournaments.mostRedCards")).toBeInTheDocument();
    expect(screen.getByText("Full creator")).toBeInTheDocument();
    expect(screen.getByText("Full hacker")).toBeInTheDocument();
    expect(screen.getByText("tournaments.noCards")).toBeInTheDocument();
  });

  // Given no leaders loaded yet, then every board shows its empty text.
  it("shows empty boards while there are no leaders", () => {
    renderOverview({ leaders: null });

    expect(screen.getByText("tournaments.noGoals")).toBeInTheDocument();
    expect(screen.getByText("tournaments.noAssists")).toBeInTheDocument();
    expect(screen.getAllByText("tournaments.noCards")).toHaveLength(2);
  });
});
