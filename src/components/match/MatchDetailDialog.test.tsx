import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { FixtureDetailData } from "../../services/matchDetailService";
import MatchDetailDialog from "./MatchDetailDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-i18next", () => {
  const translation = {
    t: (key: string, params?: Record<string, unknown>) =>
      params && "name" in params ? `${key}:${String(params.name)}` : key,
    i18n: { language: "en" },
  };
  return { useTranslation: () => translation };
});

const mockedInvoke = vi.mocked(invoke);

const stats = {
  possession_pct: 55,
  shots: 12,
  shots_on_target: 5,
  fouls: 9,
  corners: 6,
  yellow_cards: 1,
  red_cards: 0,
};

function playedDetail(): FixtureDetailData {
  return {
    fixtureId: "f1",
    competitionId: "eng-1",
    competitionName: "Premier",
    competition: "League",
    matchday: 3,
    date: "2026-08-20",
    homeTeamId: "alpha",
    homeTeamName: "Alpha FC",
    awayTeamId: "bravo",
    awayTeamName: "Bravo FC",
    result: {
      home_goals: 2,
      away_goals: 1,
      home_scorers: [{ player_id: "st", minute: 34 }],
      away_scorers: [{ player_id: "away-st", minute: 70 }],
      report: {
        total_minutes: 93,
        home_stats: stats,
        away_stats: { ...stats, possession_pct: 45 },
        events: [
          {
            minute: 34,
            event_type: "Goal",
            side: "Home",
            player_id: "st",
            secondary_player_id: null,
          },
        ],
        home_lineup: {
          formation: "4-3-3",
          play_style: "Possession",
          starters: [{ player_id: "st", position: "Striker" }],
          bench: [],
        },
      },
    },
    teamStats: [],
    playerStats: [
      {
        playerId: "st",
        teamId: "alpha",
        minutesPlayed: 90,
        goals: 1,
        assists: 0,
        shots: 4,
        shotsOnTarget: 2,
        passesCompleted: 20,
        passesAttempted: 25,
        tacklesWon: 0,
        interceptions: 0,
        foulsCommitted: 1,
        yellowCards: 0,
        redCards: 0,
        rating: 8.2,
      },
    ],
    players: [
      { id: "st", name: "Kane", fullName: "Harry Kane", position: "Striker" },
      { id: "away-st", name: "Silva", fullName: "Ana Silva", position: "Striker" },
    ],
  };
}

describe("MatchDetailDialog", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given a played fixture with a report, lineups and ratings,
  // when the dialog opens, then it shows the score and scorers, and its tabs
  // lead to the lineups and the player ratings with the man of the match.
  it("shows a played fixture's score, scorers, lineups and ratings", async () => {
    mockedInvoke.mockResolvedValueOnce(playedDetail());
    render(<MatchDetailDialog fixtureId="f1" onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: /Alpha FC 2 – 1 Bravo FC/ });
    expect(within(dialog).getByText(/Kane 34'/)).toBeInTheDocument();
    expect(mockedInvoke).toHaveBeenCalledWith("get_fixture_detail", { fixtureId: "f1" });

    fireEvent.click(within(dialog).getByRole("tab", { name: "match.lineups" }));
    expect(within(dialog).getByText("4-3-3")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("tab", { name: "match.playerRatings" }));
    const row = within(dialog).getByRole("row", { name: /Kane/ });
    expect(row).toHaveTextContent("8.2");
    expect(within(row).getByLabelText("match.motm")).toBeInTheDocument();
  });

  // Given a fixture settled by scoreline only, when the dialog opens, then it
  // shows the score and says there are no detailed statistics, with no stat tabs.
  it("says when a fixture has no detailed statistics", async () => {
    const detail = playedDetail();
    detail.playerStats = [];
    if (detail.result) detail.result.report = null;
    mockedInvoke.mockResolvedValueOnce(detail);
    render(<MatchDetailDialog fixtureId="f1" onClose={vi.fn()} />);

    expect(await screen.findByText("match.noDetailedStats")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "match.lineups" })).toBeNull();
  });

  // Given the dialog open, when Escape is pressed, then it asks to close; and
  // focus starts on the Close button.
  it("takes focus and closes on Escape", async () => {
    mockedInvoke.mockResolvedValueOnce(playedDetail());
    const onClose = vi.fn();
    render(<MatchDetailDialog fixtureId="f1" onClose={onClose} />);

    await screen.findByRole("dialog");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "common.close" })),
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  // Given the backend fails, when the dialog opens, then it says the details
  // could not be loaded.
  it("says when the details cannot be loaded", async () => {
    mockedInvoke.mockRejectedValueOnce("be.error.liveMatch.fixtureNotFound");
    render(<MatchDetailDialog fixtureId="f1" onClose={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("match.detailsUnavailable");
  });

  // Given the tabs, when the right and left arrows are pressed on one, then the
  // next or previous tab is selected and focused, wrapping at the ends.
  it("moves between tabs with the arrow keys", async () => {
    mockedInvoke.mockResolvedValueOnce(playedDetail());
    render(<MatchDetailDialog fixtureId="f1" onClose={vi.fn()} />);

    const overview = await screen.findByRole("tab", { name: "match.overview" });
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    const stats = screen.getByRole("tab", { name: "match.stats" });
    expect(stats).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(stats);
    expect(overview).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(stats, { key: "ArrowLeft" });
    fireEvent.keyDown(overview, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "match.playerRatings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // Given the stats tab, then each column is headed by its team's name, so the
  // figures are not told apart by colour and position alone.
  it("heads the team figures with the teams' names", async () => {
    mockedInvoke.mockResolvedValueOnce(playedDetail());
    render(<MatchDetailDialog fixtureId="f1" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: "match.stats" }));

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Alpha FC")).toBeInTheDocument();
    expect(within(panel).getByText("Bravo FC")).toBeInTheDocument();
  });
});
