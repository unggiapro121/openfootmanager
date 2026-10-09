import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LeaderEntryData } from "../../services/competitionsService";
import TournamentsLeaderboard from "./TournamentsLeaderboard";

vi.mock("react-i18next", async () => {
  const { useRef } = await import("react");
  return {
    useTranslation: () => {
      useRef(null);
      return {
        t: (key: string) => {
          if (key === "common.viewTeam") return "View team";
          if (key === "squad.viewProfile") return "View profile";
          return key;
        },
      };
    },
  };
});

function leader(overrides: Partial<LeaderEntryData> = {}): LeaderEntryData {
  return {
    playerId: "player-1",
    name: "Striker",
    fullName: "Ada Striker",
    teamId: "team-1",
    teamName: "Alpha FC",
    value: 12,
    ...overrides,
  };
}

function renderBoard(props: Partial<React.ComponentProps<typeof TournamentsLeaderboard>> = {}) {
  return render(
    <TournamentsLeaderboard
      title="tournaments.topScorers"
      emptyText="tournaments.noGoals"
      entries={[leader()]}
      testIdPrefix="tournaments-top-scorer"
      onSelectTeam={vi.fn()}
      {...props}
    />,
  );
}

describe("TournamentsLeaderboard", () => {
  // Given no one on the board yet, then it says so instead of an empty list.
  it("says so when the board is empty", () => {
    renderBoard({ entries: [] });

    expect(screen.getByText("tournaments.noGoals")).toBeInTheDocument();
  });

  // Given two leaders, then each is ranked with his club and tally, under the title.
  it("ranks the leaders with their club and tally", () => {
    renderBoard({
      entries: [
        leader(),
        leader({
          playerId: "player-2",
          fullName: "Cy Winger",
          teamId: "team-2",
          teamName: "Beta United",
          value: 9,
        }),
      ],
    });

    expect(screen.getByText("tournaments.topScorers")).toBeInTheDocument();
    expect(screen.getByText("Ada Striker")).toBeInTheDocument();
    expect(screen.getByText("Alpha FC")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Cy Winger")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  // A player can be clubless; the row still has to render.
  it("falls back to the team id when there is no club name", () => {
    renderBoard({ entries: [leader({ teamId: "team-9", teamName: null })] });

    expect(screen.getByText("team-9")).toBeInTheDocument();
  });

  it("offers the profile and the club when both are reachable", () => {
    const onSelectPlayer = vi.fn();
    renderBoard({ onSelectPlayer });

    fireEvent.contextMenu(screen.getByTestId("tournaments-top-scorer-player-1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "View profile" }));

    expect(onSelectPlayer).toHaveBeenCalledWith("player-1");
  });

  it("offers only the club when there is no way to open a profile", () => {
    const onSelectTeam = vi.fn();
    renderBoard({ onSelectTeam });

    fireEvent.contextMenu(screen.getByTestId("tournaments-top-scorer-player-1"));

    expect(screen.queryByRole("menuitem", { name: "View profile" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "View team" }));
    expect(onSelectTeam).toHaveBeenCalledWith("team-1");
  });
});
