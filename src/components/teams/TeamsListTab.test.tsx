import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { GameStateData } from "../../store/gameStore";
import type { TeamCard, TeamsDirectory, TeamsDirectoryQuery } from "../../services/teamsService";
import TeamsListTab from "./TeamsListTab";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      const labels: Record<string, string> = {
        "teams.yourTeam": "Your Team",
        "common.position": "Position",
        "teams.squad": "Squad",
        "teams.avgOvr": "Avg OVR",
        "teams.rep": "Rep",
        "common.value": "Value",
        "common.pts": "Pts",
        "teams.est": "Est",
        "teams.searchPlaceholder": "Search clubs",
        "teams.noResults": "No clubs match your search.",
        "teams.otherClubs": "Other clubs",
        "teams.region": "Region",
        "teams.country": "Country",
        "teams.league": "League",
        "teams.club": "Club",
        "teams.playStyle": "Style",
        "nations.eng": "England",
        "nations.esp": "Spain",
        "common.playStyles.Balanced": "Equilibrado",
        "common.playStyles.Counter": "Contra-ataque",
      };
      if (labels[key]) return labels[key];
      if (fallback && typeof fallback === "object") {
        return fallback.defaultValue ?? key;
      }
      return fallback ?? key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("../ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui")>();
  return {
    ...actual,
    TeamLocation: ({ city, countryCode }: { city: string; countryCode: string }) => (
      <span>{`${city}, ${countryCode}`}</span>
    ),
  };
});

const mockedInvoke = vi.mocked(invoke);

function gameStateWithManagerTeam(teamId: string | null): GameStateData {
  return {
    clock: {
      current_date: "2026-08-01T00:00:00Z",
      start_date: "2026-07-01T00:00:00Z",
    },
    manager: {
      id: "manager-1",
      first_name: "Jane",
      last_name: "Doe",
      date_of_birth: "1980-01-01",
      nationality: "GB",
      reputation: 50,
      satisfaction: 50,
      fan_approval: 50,
      team_id: teamId,
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
    teams: [],
    players: [],
    staff: [],
    messages: [],
    news: [],
    league: null,
    scouting_assignments: [],
    board_objectives: [],
  };
}

function buildCard(overrides: {
  id: string;
  name: string;
  city?: string;
  short_name?: string;
  founded_year?: number;
  play_style?: string;
  league_pos: number;
  points?: number;
}): TeamCard {
  return {
    team: {
      id: overrides.id,
      name: overrides.name,
      short_name: overrides.short_name ?? overrides.name.slice(0, 3).toUpperCase(),
      city: overrides.city ?? "London",
      country: "GB",
      colors: { primary: "#000000", secondary: "#ffffff" },
      formation: "4-4-2",
      play_style: overrides.play_style ?? "Balanced",
      founded_year: overrides.founded_year ?? 1900,
      reputation: 50,
      media: { logo: null },
    },
    roster_size: 22,
    avg_ovr: 65,
    total_value: 1_000_000,
    league_pos: overrides.league_pos,
    standing:
      overrides.points !== undefined
        ? {
            played: 1,
            won: 0,
            drawn: 0,
            lost: 0,
            goals_for: 0,
            goals_against: 0,
            points: overrides.points,
          }
        : null,
  };
}

function applySearch(cards: TeamCard[], search: string | null): TeamCard[] {
  if (!search) return cards;
  const needle = search.toLowerCase();
  return cards.filter(
    (card) =>
      card.team.name.toLowerCase().includes(needle) ||
      card.team.city.toLowerCase().includes(needle),
  );
}

const spanishClub = () =>
  buildCard({ id: "team-es", name: "Gamma CF", city: "Madrid", league_pos: 1 });

function buildDirectory(cards: TeamCard[], search: string | null): TeamsDirectory {
  const english = applySearch(cards, search).sort((a, b) => a.league_pos - b.league_pos);
  const spanish = applySearch([spanishClub()], search);
  const leagues = [
    { id: "league-1", name: "League", country_id: "ENG", teams: english },
    { id: "liga-1", name: "Liga", country_id: "ESP", teams: spanish },
  ].filter((league) => league.teams.length > 0);
  if (leagues.length === 0) {
    return { regions: [] };
  }
  return {
    regions: [
      {
        id: "europe",
        team_count: english.length + spanish.length,
        leagues,
      },
    ],
  };
}

function setupDirectoryMock(cards: TeamCard[]) {
  mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd !== "get_teams_directory") return undefined;
    const query = (args as { query: TeamsDirectoryQuery }).query;
    return buildDirectory(cards, query.search);
  });
}

/** The names of the clubs in the table, top to bottom. */
function clubRows(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelector("button")?.textContent ?? "");
}

function pick(filter: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: filter }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("TeamsListTab", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given the user's club in an English league, when the screen opens, then the
  // filters stand on its region, country and league, and the table lists that
  // league's clubs by position with the user's marked.
  it("opens on the user's league, ordered by position", async () => {
    setupDirectoryMock([
      buildCard({ id: "team-1", name: "Alpha FC", league_pos: 2, points: 1 }),
      buildCard({ id: "team-2", name: "Beta FC", league_pos: 1, points: 3 }),
    ]);

    render(<TeamsListTab gameState={gameStateWithManagerTeam("team-1")} onSelectTeam={vi.fn()} />);

    await screen.findByText("Beta FC");
    expect(screen.getByRole("combobox", { name: "Country" })).toHaveTextContent("England");
    expect(screen.getByRole("combobox", { name: "League" })).toHaveTextContent("League");
    expect(clubRows()).toEqual(["Beta FC", "Alpha FC"]);
    expect(screen.getByText("Your Team")).toBeInTheDocument();
    expect(screen.queryByText("Gamma CF")).not.toBeInTheDocument();
  });

  // Given another country picked, then its league's clubs replace the list.
  it("lists another country's league when it is picked", async () => {
    setupDirectoryMock([buildCard({ id: "team-1", name: "Alpha FC", league_pos: 1 })]);

    render(<TeamsListTab gameState={gameStateWithManagerTeam("team-1")} onSelectTeam={vi.fn()} />);
    await screen.findByText("Alpha FC");

    pick("Country", "Spain");

    expect(clubRows()).toEqual(["Gamma CF"]);
    expect(screen.getByRole("combobox", { name: "League" })).toHaveTextContent("Liga");
  });

  // Given a search, then matching clubs from every league are listed, whatever
  // the filters say.
  it("searches clubs across every league", async () => {
    setupDirectoryMock([
      buildCard({ id: "team-1", name: "Alpha FC", league_pos: 2 }),
      buildCard({ id: "team-2", name: "Beta FC", league_pos: 1 }),
    ]);

    render(<TeamsListTab gameState={gameStateWithManagerTeam("team-1")} onSelectTeam={vi.fn()} />);
    await screen.findByText("Alpha FC");

    fireEvent.change(screen.getByPlaceholderText("Search clubs"), {
      target: { value: "a" },
    });

    await waitFor(() => expect(screen.getByText("Gamma CF")).toBeInTheDocument());
    expect(screen.getByText("Alpha FC")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "League" })).toBeNull();
  });

  it("shows an empty state when no clubs match", async () => {
    setupDirectoryMock([buildCard({ id: "team-1", name: "Alpha FC", league_pos: 1 })]);

    render(<TeamsListTab gameState={gameStateWithManagerTeam("team-1")} onSelectTeam={vi.fn()} />);

    await screen.findByText("Alpha FC");

    fireEvent.change(screen.getByPlaceholderText("Search clubs"), {
      target: { value: "zzzzz" },
    });

    await waitFor(() => {
      expect(screen.getByText("No clubs match your search.")).toBeInTheDocument();
    });
  });

  // The club's name is a button, so the row can be opened from the keyboard.
  it("opens a club from its name", async () => {
    const onSelectTeam = vi.fn();
    setupDirectoryMock([
      buildCard({ id: "team-1", name: "Alpha FC", league_pos: 2 }),
      buildCard({ id: "team-2", name: "Beta FC", league_pos: 1 }),
    ]);

    render(
      <TeamsListTab gameState={gameStateWithManagerTeam("team-1")} onSelectTeam={onSelectTeam} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Beta FC" }));

    expect(onSelectTeam).toHaveBeenCalledWith("team-2");
  });

  it("renders translated play styles instead of raw values", async () => {
    setupDirectoryMock([
      buildCard({ id: "team-1", name: "Alpha FC", league_pos: 1, play_style: "Balanced" }),
      buildCard({ id: "team-2", name: "Beta FC", league_pos: 2, play_style: "Counter" }),
    ]);

    render(<TeamsListTab gameState={gameStateWithManagerTeam("team-1")} onSelectTeam={vi.fn()} />);

    expect(await screen.findByText("Equilibrado")).toBeInTheDocument();
    expect(screen.getByText("Contra-ataque")).toBeInTheDocument();
    expect(screen.queryByText("Balanced")).not.toBeInTheDocument();
  });
});
