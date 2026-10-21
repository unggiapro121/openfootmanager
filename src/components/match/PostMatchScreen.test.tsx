import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PostMatchScreen, { computeGoalSources } from "./PostMatchScreen";
import type { GameStateData } from "../../store/gameStore";
import type { MatchEvent } from "./types";
import { ThemeProvider } from "../../context/ThemeContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query === "(prefers-color-scheme: dark)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "schedule.matchday") {
        return `Matchday ${params?.number}`;
      }
      if (key === "match.masteryGain") {
        return `+${params?.xp} XP · ${params?.style}`;
      }
      if (key === "match.masteryReached") {
        return `now ${params?.mastery}`;
      }
      if (key === "match.masteryStartingStyle") {
        return "XP goes to the style the side started in";
      }
      if (key.startsWith("common.playStyles.")) {
        return key.replace("common.playStyles.", "");
      }
      if (key === "match.otherMatches") {
        return "Other Matches";
      }
      if (key === "match.otherMatchesToday") {
        return "Other Matches Today";
      }
      if (key === "match.otherMatchesUnavailable") {
        return "Other match context unavailable for this fixture yet.";
      }
      if (key === "match.viewDetails") {
        return "View details";
      }
      if (key === "match.matchDetails") {
        return "Match Details";
      }
      if (key === "common.close") {
        return "Close";
      }
      if (key === "match.roundSummaryUnavailable") {
        return "Round summary unavailable.";
      }
      if (key === "match.roundSummary") {
        return "Round Summary";
      }
      if (key === "home.leagueTable") {
        return "League Table";
      }
      if (key === "home.topScorers") {
        return "Top Scorers";
      }
      if (key === "home.noGoals") {
        return "No goals scored yet.";
      }
      if (key === "common.none") {
        return "None";
      }
      if (params?.team) {
        return `${key}:${params.team}`;
      }
      return key;
    },
  }),
}));

function makeSnapshot() {
  return {
    phase: "FullTime",
    current_minute: 90,
    home_score: 2,
    away_score: 1,
    possession: "Home" as const,
    ball_zone: "Midfield",
    home_team: {
      id: "team1",
      name: "Alpha FC",
      formation: "4-4-2",
      play_style: "Balanced",
      players: [
        {
          id: "p1",
          name: "Alice",
          position: "Forward",
          ovr: 70,
          condition: 90,
          pace: 70,
          stamina: 70,
          strength: 70,
          agility: 70,
          passing: 70,
          shooting: 70,
          tackling: 40,
          dribbling: 70,
          defending: 40,
          positioning: 70,
          vision: 70,
          decisions: 70,
          composure: 70,
          aggression: 50,
          teamwork: 70,
          leadership: 60,
          handling: 20,
          reflexes: 20,
          aerial: 50,
          long_passing: 70,
          crossing: 70,
          curve: 70,
          free_kick: 70,
          long_shots: 70,
          heading: 50,
          first_touch: 70,
          traits: [],
          role: "Standard",
        },
      ],
    },
    away_team: {
      id: "team2",
      name: "Beta FC",
      formation: "4-4-2",
      play_style: "Balanced",
      players: [
        {
          id: "p2",
          name: "Bob",
          position: "Forward",
          ovr: 70,
          condition: 90,
          pace: 70,
          stamina: 70,
          strength: 70,
          agility: 70,
          passing: 70,
          shooting: 70,
          tackling: 40,
          dribbling: 70,
          defending: 40,
          positioning: 70,
          vision: 70,
          decisions: 70,
          composure: 70,
          aggression: 50,
          teamwork: 70,
          leadership: 60,
          handling: 20,
          reflexes: 20,
          aerial: 50,
          long_passing: 70,
          crossing: 70,
          curve: 70,
          free_kick: 70,
          long_shots: 70,
          heading: 50,
          first_touch: 70,
          traits: [],
          role: "Standard",
        },
      ],
    },
    home_bench: [],
    away_bench: [],
    home_possession_pct: 52,
    away_possession_pct: 48,
    events: [],
    home_subs_made: 0,
    away_subs_made: 0,
    max_subs: 5,
    home_set_pieces: {
      free_kick_taker: null,
      corner_taker: null,
      penalty_taker: null,
      captain: null,
    },
    away_set_pieces: {
      free_kick_taker: null,
      corner_taker: null,
      penalty_taker: null,
      captain: null,
    },
    substitutions: [],
    allows_extra_time: false,
    home_yellows: {},
    away_yellows: {},
    sent_off: [],
  };
}

function makeGameState() {
  return {
    clock: {
      current_date: "2026-08-01",
      start_date: "2026-08-01",
    },
    manager: {
      id: "mgr1",
      first_name: "Alex",
      last_name: "Manager",
      date_of_birth: "1980-01-01",
      nationality: "GB",
      reputation: 50,
      satisfaction: 50,
      fan_approval: 50,
      team_id: "team1",
      career_stats: {
        matches_managed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        trophies: 0,
        best_finish: null,
      },
      career_history: [],
    },
    teams: [
      {
        id: "team1",
        name: "Alpha FC",
        short_name: "ALP",
        country: "England",
        city: "Alpha",
        stadium_name: "Alpha Park",
        stadium_capacity: 20000,
        finance: 1000000,
        manager_id: "mgr1",
        reputation: 50,
        wage_budget: 100000,
        transfer_budget: 500000,
        season_income: 0,
        season_expenses: 0,
        formation: "4-4-2",
        play_style: "Balanced",
        training_focus: "Physical",
        training_intensity: "Medium",
        training_schedule: "Balanced",
        founded_year: 1900,
        colors: { primary: "#00ff00", secondary: "#ffffff" },
        starting_xi_ids: [],
        match_roles: {
          captain: null,
          vice_captain: null,
          penalty_taker: null,
          free_kick_taker: null,
          corner_taker: null,
        },
        form: ["W", "W", "D"],
        history: [],
      },
      {
        id: "team2",
        name: "Beta FC",
        short_name: "BET",
        country: "England",
        city: "Beta",
        stadium_name: "Beta Park",
        stadium_capacity: 20000,
        finance: 1000000,
        manager_id: null,
        reputation: 50,
        wage_budget: 100000,
        transfer_budget: 500000,
        season_income: 0,
        season_expenses: 0,
        formation: "4-4-2",
        play_style: "Balanced",
        training_focus: "Physical",
        training_intensity: "Medium",
        training_schedule: "Balanced",
        founded_year: 1900,
        colors: { primary: "#0000ff", secondary: "#ffffff" },
        starting_xi_ids: [],
        match_roles: {
          captain: null,
          vice_captain: null,
          penalty_taker: null,
          free_kick_taker: null,
          corner_taker: null,
        },
        form: ["L", "D", "W"],
        history: [],
      },
    ],
    players: [
      {
        id: "p1",
        match_name: "Alice",
        full_name: "Alice Forward",
        date_of_birth: "2000-01-01",
        nationality: "GB",
        position: "Forward",
        natural_position: "Forward",
        alternate_positions: [],
        training_focus: null,
        attributes: {
          pace: 70,
          stamina: 70,
          strength: 70,
          agility: 70,
          passing: 70,
          shooting: 70,
          tackling: 40,
          dribbling: 70,
          defending: 40,
          positioning: 70,
          vision: 70,
          decisions: 70,
          composure: 70,
          aggression: 50,
          teamwork: 70,
          leadership: 60,
          handling: 20,
          reflexes: 20,
          aerial: 50,
          long_passing: 70,
          crossing: 70,
          curve: 70,
          free_kick: 70,
          long_shots: 70,
          heading: 50,
          first_touch: 70,
        },
        condition: 90,
        morale: 70,
        injury: null,
        team_id: "team1",
        contract_end: null,
        wage: 10000,
        market_value: 1000000,
        stats: {
          appearances: 0,
          goals: 0,
          assists: 0,
          clean_sheets: 0,
          avg_rating: 0,
          minutes_played: 0,
          yellow_cards: 0,
          red_cards: 0,
        },
        form: [],
        personality: null,
        morale_core: {
          base: 70,
          confidence: 70,
          manager_trust: 70,
          happiness: 70,
          pending_promise: null,
          unresolved_issue: null,
          last_playing_time_concern: null,
        },
      },
      {
        id: "p2",
        match_name: "Bob",
        full_name: "Bob Forward",
        date_of_birth: "2000-01-01",
        nationality: "GB",
        position: "Forward",
        natural_position: "Forward",
        alternate_positions: [],
        training_focus: null,
        attributes: {
          pace: 70,
          stamina: 70,
          strength: 70,
          agility: 70,
          passing: 70,
          shooting: 70,
          tackling: 40,
          dribbling: 70,
          defending: 40,
          positioning: 70,
          vision: 70,
          decisions: 70,
          composure: 70,
          aggression: 50,
          teamwork: 70,
          leadership: 60,
          handling: 20,
          reflexes: 20,
          aerial: 50,
          long_passing: 70,
          crossing: 70,
          curve: 70,
          free_kick: 70,
          long_shots: 70,
          heading: 50,
          first_touch: 70,
        },
        condition: 90,
        morale: 70,
        injury: null,
        team_id: "team2",
        contract_end: null,
        wage: 10000,
        market_value: 1000000,
        stats: {
          appearances: 0,
          goals: 0,
          assists: 0,
          clean_sheets: 0,
          avg_rating: 0,
          minutes_played: 0,
          yellow_cards: 0,
          red_cards: 0,
        },
        form: [],
        personality: null,
        morale_core: {
          base: 70,
          confidence: 70,
          manager_trust: 70,
          happiness: 70,
          pending_promise: null,
          unresolved_issue: null,
          last_playing_time_concern: null,
        },
      },
    ],
    staff: [],
    messages: [],
    news: [],
    league: null,
    scouting_assignments: [],
    board_objectives: [],
  } as unknown as GameStateData;
}

describe("PostMatchScreen", (): void => {
  it("renders the Team Talk tab by default for a manager", (): void => {
    render(
      <ThemeProvider>
        <PostMatchScreen
          snapshot={makeSnapshot()}
          playerRatings={{}}
          gameState={makeGameState()}
          userSide="Home"
          isSpectator={false}
          importantEvents={[]}
          onContinue={() => {}}
          onFinish={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getAllByText("match.postMatchTeamTalk").length).toBeGreaterThan(0);
    expect(screen.getByText("match.matchReport")).toBeInTheDocument();
    expect(screen.getByText("match.playerRatings")).toBeInTheDocument();
  });

  it("switches to Match Report tab and shows scorers section", (): void => {
    render(
      <ThemeProvider>
        <PostMatchScreen
          snapshot={makeSnapshot()}
          playerRatings={{}}
          gameState={makeGameState()}
          userSide="Home"
          isSpectator={false}
          importantEvents={[]}
          onContinue={() => {}}
          onFinish={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("match.matchReport"));

    expect(screen.getByText("match.scorers")).toBeInTheDocument();
    expect(screen.getByText("match.quickStats")).toBeInTheDocument();
  });

  it("shows the play style XP a managed match earned, for the starting style", (): void => {
    render(
      <ThemeProvider>
        <PostMatchScreen
          snapshot={makeSnapshot()}
          playerRatings={{}}
          gameState={makeGameState()}
          userSide="Home"
          isSpectator={false}
          importantEvents={[]}
          masteryGain={{ style: "Counter", xp: 15, mastery_before: 54, mastery_after: 55 }}
          onContinue={() => {}}
          onFinish={() => {}}
        />
      </ThemeProvider>,
    );

    const line = screen.getByTestId("post-match-mastery");
    expect(line).toHaveTextContent("+15 XP · Counter");
    expect(line).toHaveTextContent("now 55");
    expect(line).toHaveTextContent("XP goes to the style the side started in");
  });

  it("shows no play style XP when the match earned none", (): void => {
    render(
      <ThemeProvider>
        <PostMatchScreen
          snapshot={makeSnapshot()}
          playerRatings={{}}
          gameState={makeGameState()}
          userSide="Home"
          isSpectator={false}
          importantEvents={[]}
          onContinue={() => {}}
          onFinish={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.queryByTestId("post-match-mastery")).not.toBeInTheDocument();
  });

  it("renders Match Report tab by default for a spectator", (): void => {
    render(
      <ThemeProvider>
        <PostMatchScreen
          snapshot={makeSnapshot()}
          playerRatings={{}}
          gameState={makeGameState()}
          userSide={null}
          isSpectator={true}
          importantEvents={[]}
          onContinue={() => {}}
          onFinish={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("match.scorers")).toBeInTheDocument();
  });

  it("calls onContinue when manager clicks Continue", (): void => {
    const onContinue = vi.fn();
    const onFinish = vi.fn();
    render(
      <ThemeProvider>
        <PostMatchScreen
          snapshot={makeSnapshot()}
          playerRatings={{}}
          gameState={makeGameState()}
          userSide="Home"
          isSpectator={false}
          importantEvents={[]}
          onContinue={onContinue}
          onFinish={onFinish}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("match.continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("calls onFinish when spectator clicks Continue to Dashboard", (): void => {
    const onContinue = vi.fn();
    const onFinish = vi.fn();
    render(
      <ThemeProvider>
        <PostMatchScreen
          snapshot={makeSnapshot()}
          playerRatings={{}}
          gameState={makeGameState()}
          userSide={null}
          isSpectator={true}
          importantEvents={[]}
          onContinue={onContinue}
          onFinish={onFinish}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("match.continueDashboard"));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("resolves a level score via the shootout and shows the pens score", (): void => {
    // Regression: shootout kicks used to be folded into the match score, so a
    // 1-1 tie won on penalties displayed as 5-4 and the verdict came from the
    // inflated score. Now the score stays level and the shootout decides.
    const snapshot = {
      ...makeSnapshot(),
      home_score: 1,
      away_score: 1,
      penalty_shootout: {
        home_taken: 6,
        away_taken: 6,
        home_scored: 5,
        away_scored: 4,
        sudden_death: true,
      },
    };
    render(
      <ThemeProvider>
        <PostMatchScreen
          snapshot={snapshot}
          playerRatings={{}}
          gameState={makeGameState()}
          userSide="Home"
          isSpectator={false}
          importantEvents={[]}
          onContinue={() => {}}
          onFinish={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("match.victory")).toBeInTheDocument();
    expect(screen.queryByText("match.draw")).not.toBeInTheDocument();
    expect(screen.getByText(/match\.pen 5–4/)).toBeInTheDocument();
  });

  it("keeps a level score without a shootout as a draw", (): void => {
    const snapshot = {
      ...makeSnapshot(),
      home_score: 1,
      away_score: 1,
    };
    render(
      <ThemeProvider>
        <PostMatchScreen
          snapshot={snapshot}
          playerRatings={{}}
          gameState={makeGameState()}
          userSide="Home"
          isSpectator={false}
          importantEvents={[]}
          onContinue={() => {}}
          onFinish={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("match.draw")).toBeInTheDocument();
    expect(screen.queryByText("match.victory")).not.toBeInTheDocument();
    expect(screen.queryByText(/match\.pen \d/)).not.toBeInTheDocument();
  });

  it("shows a defeat verdict when the user loses the shootout", (): void => {
    const snapshot = {
      ...makeSnapshot(),
      home_score: 1,
      away_score: 1,
      penalty_shootout: {
        home_taken: 5,
        away_taken: 5,
        home_scored: 3,
        away_scored: 4,
        sudden_death: false,
      },
    };
    render(
      <ThemeProvider>
        <PostMatchScreen
          snapshot={snapshot}
          playerRatings={{}}
          gameState={makeGameState()}
          userSide="Home"
          isSpectator={false}
          importantEvents={[]}
          onContinue={() => {}}
          onFinish={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("match.defeat")).toBeInTheDocument();
  });

  it("calls onFinish when manager clicks Skip", (): void => {
    const onContinue = vi.fn();
    const onFinish = vi.fn();
    render(
      <ThemeProvider>
        <PostMatchScreen
          snapshot={makeSnapshot()}
          playerRatings={{}}
          gameState={makeGameState()}
          userSide="Home"
          isSpectator={false}
          importantEvents={[]}
          onContinue={onContinue}
          onFinish={onFinish}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("match.skip"));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// computeGoalSources unit tests
// ---------------------------------------------------------------------------

function makeEvent(
  event_type: string,
  side: "Home" | "Away",
  goal_source?: MatchEvent["goal_source"],
): MatchEvent {
  return {
    minute: 1,
    event_type,
    side,
    zone: "Midfield",
    player_id: null,
    secondary_player_id: null,
    goal_source,
  };
}

const NONE = { openPlay: 0, headers: 0, longShots: 0, corners: 0, freekicks: 0, penalties: 0 };

describe("computeGoalSources", (): void => {
  it("counts each goal under the source the engine stamped on it", (): void => {
    const events: MatchEvent[] = [
      makeEvent("Goal", "Home", "OpenPlay"),
      makeEvent("Goal", "Home", "Header"),
      makeEvent("Goal", "Home", "LongShot"),
      makeEvent("Goal", "Home", "Corner"),
      makeEvent("Goal", "Home", "FreeKick"),
      makeEvent("PenaltyGoal", "Home", "Penalty"),
    ];
    expect(computeGoalSources(events, "Home")).toEqual({
      openPlay: 1,
      headers: 1,
      longShots: 1,
      corners: 1,
      freekicks: 1,
      penalties: 1,
    });
  });

  it("counts a goal straight from a free kick on the free-kick row", (): void => {
    const events: MatchEvent[] = [
      makeEvent("Goal", "Home", "DirectFreeKick"),
      makeEvent("Goal", "Home", "FreeKick"),
    ];
    expect(computeGoalSources(events, "Home")).toEqual({ ...NONE, freekicks: 2 });
  });

  it("counts only the asked side's goals", (): void => {
    const events: MatchEvent[] = [
      makeEvent("Corner", "Away"),
      makeEvent("Goal", "Away", "Corner"),
      makeEvent("Goal", "Home", "OpenPlay"),
    ];
    expect(computeGoalSources(events, "Home")).toEqual({ ...NONE, openPlay: 1 });
    expect(computeGoalSources(events, "Away")).toEqual({ ...NONE, corners: 1 });
  });

  it("does not infer a set piece from the events before a goal", (): void => {
    // A corner, then an open-play goal: the engine said open play, so it is.
    const events: MatchEvent[] = [
      makeEvent("Corner", "Home"),
      makeEvent("Goal", "Home", "OpenPlay"),
    ];
    expect(computeGoalSources(events, "Home")).toEqual({ ...NONE, openPlay: 1 });
  });

  it("reads a goal saved before event protocol 2 as open play, a penalty as a penalty", (): void => {
    const events: MatchEvent[] = [makeEvent("Goal", "Home"), makeEvent("PenaltyGoal", "Home")];
    expect(computeGoalSources(events, "Home")).toEqual({ ...NONE, openPlay: 1, penalties: 1 });
  });
});
