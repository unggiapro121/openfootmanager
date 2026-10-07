import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerRatingsPanel } from "./PostMatchHelpers";
import type { MatchSnapshot } from "./types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params?.team ? `${key}:${params.team}` : key,
  }),
}));

function player(id: string, name: string, position: string) {
  return { id, name, position };
}

/** Home side at full time: two on the pitch, one taken off (now on the bench), one unused. */
function finishedSnapshot(): MatchSnapshot {
  return {
    phase: "Finished",
    current_minute: 90,
    home_score: 1,
    away_score: 0,
    home_team: {
      id: "team1",
      name: "Alpha FC",
      players: [
        player("striker", "Sam Striker", "Forward"),
        player("keeper", "Kim Keeper", "Goalkeeper"),
      ],
    },
    away_team: { id: "team2", name: "Beta FC", players: [player("rival", "Rob Rival", "Forward")] },
    home_bench: [
      player("subbed_off", "Ollie Off", "Midfielder"),
      player("unused", "Uma Unused", "Defender"),
    ],
    away_bench: [],
    // A goal the old client-side formula would have rewarded: the panel must ignore it.
    events: [
      { minute: 30, event_type: "Goal", side: "Home", zone: "AwayBox", player_id: "keeper" },
    ],
  } as unknown as MatchSnapshot;
}

const ratings = { striker: 7.4, keeper: 6.1, subbed_off: 6.6, rival: 5.2 };

function rows(): string[] {
  const panel = screen.getByRole("heading", { name: "match.ratings:Alpha FC" }).closest("div")!
    .parentElement!;
  return within(panel)
    .getAllByTestId("player-rating-row")
    .map((row) => row.textContent ?? "");
}

describe("PlayerRatingsPanel", () => {
  it("shows the engine's ratings, best first, including a player taken off during the match", () => {
    render(
      <PlayerRatingsPanel
        snapshot={finishedSnapshot()}
        playerRatings={ratings}
        side="Home"
        teamColor="red"
        userSide="Home"
      />,
    );

    expect(rows()).toEqual([
      expect.stringContaining("7.4Sam Striker"),
      expect.stringContaining("6.6Ollie Off"),
      expect.stringContaining("6.1Kim Keeper"),
    ]);
  });

  it("leaves out players the engine did not rate", () => {
    render(
      <PlayerRatingsPanel
        snapshot={finishedSnapshot()}
        playerRatings={ratings}
        side="Home"
        teamColor="red"
        userSide="Home"
      />,
    );

    expect(screen.queryByText("Uma Unused")).not.toBeInTheDocument();
  });

  it("names the highest-rated player on the user's side as man of the match", () => {
    render(
      <PlayerRatingsPanel
        snapshot={finishedSnapshot()}
        playerRatings={ratings}
        side="Home"
        teamColor="red"
        userSide="Home"
      />,
    );

    const motm = screen.getByText("match.motm").parentElement!;
    expect(motm).toHaveTextContent("Sam Striker");
  });
});
