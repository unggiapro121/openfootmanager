import { fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData, LeagueData } from "../store/gameStore";
import { useGameStore } from "../store/gameStore";
import { createPlayer, createTeam } from "../test-utils/factories";
import { ThemeProvider } from "../context/ThemeContext";
import TeamSelection from "./TeamSelection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../services/portraitService", () => ({
  prewarmManagerSquadPortraits: vi.fn(),
}));

vi.mock("../store/gameStore", () => ({ useGameStore: vi.fn() }));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params?.defaultValue !== undefined ? String(params.defaultValue) : key,
    i18n: { language: "en" },
  }),
}));

// jsdom doesn't implement matchMedia, which ThemeProvider reads on mount.
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

function league(overrides: Partial<LeagueData> = {}): LeagueData {
  return {
    id: "epl",
    name: "Premier League",
    season: 2025,
    scope: "Domestic",
    kind: "League",
    region_id: "europe",
    country_id: "GB",
    participant_ids: ["team-1"],
    priority: 1,
    fixtures: [],
    standings: [],
    ...overrides,
  };
}

function buildGameState(): GameStateData {
  return {
    teams: [
      createTeam({ id: "team-1", name: "Alpha FC", country: "GB" }),
      createTeam({ id: "team-2", name: "Beta Town", country: "GB" }),
    ],
    players: [createPlayer({ id: "p1", team_id: "team-1" })],
    regions: [{ id: "europe", name: "Europe", country_codes: ["GB"] }],
    competitions: [
      league(),
      league({
        id: "championship",
        name: "Championship",
        participant_ids: ["team-2"],
        priority: 2,
      }),
      league({
        id: "ucl",
        name: "Champions League",
        scope: "Continental",
        kind: "Cup",
        country_id: undefined,
        participant_ids: ["team-1"],
        priority: 0,
      }),
    ],
    league: null,
    manager: { first_name: "Sam", last_name: "Boss" },
  } as unknown as GameStateData;
}

describe("TeamSelection", () => {
  beforeEach(() => {
    vi.mocked(useGameStore).mockReturnValue({
      gameState: buildGameState(),
      setGameState: vi.fn(),
      setGameActive: vi.fn(),
    } as unknown as ReturnType<typeof useGameStore>);
  });

  function renderPage() {
    render(
      <ThemeProvider>
        <TeamSelection />
      </ThemeProvider>,
    );
  }

  /** Given the page, When it renders, Then filters, club grid and sidebar are shown. */
  it("renders the filters, the club grid, and the selected-team sidebar", () => {
    renderPage();

    // Page chrome + filters
    expect(screen.getByText("teamSelect.title")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "teamSelect.league" })).toBeInTheDocument();

    // Club grid renders the team; sidebar auto-selects the first team, so the
    // club name appears in both the card and the sidebar header.
    expect(screen.getAllByText("Alpha FC").length).toBeGreaterThanOrEqual(2);

    // Confirm button reflects the auto-selected club.
    expect(screen.getByText("teamSelect.manage")).toBeInTheDocument();
  });

  /** Given the page, When it renders, Then the header carrying the confirm button stays pinned. */
  it("keeps the header with the confirm button sticky", () => {
    renderPage();

    expect(screen.getByRole("banner")).toHaveClass("sticky", "top-0");
  });

  /** Given two domestic leagues in a country, When one is picked, Then only its clubs are listed. */
  it("offers the country's domestic leagues and filters clubs by the chosen one", () => {
    renderPage();
    expect(screen.getByText("Beta Town")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "teamSelect.league" }));
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["teamSelect.allLeagues", "Premier League", "Championship"]);

    fireEvent.click(screen.getByRole("option", { name: "Premier League" }));

    expect(screen.queryByText("Beta Town")).not.toBeInTheDocument();
    expect(screen.getAllByText("Alpha FC").length).toBeGreaterThanOrEqual(1);
  });

  /** Given no simulation-scope picker, When the club is confirmed, Then every competition is simulated. */
  it("simulates every competition when confirming the club", () => {
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "teamSelect.manage" }));

    expect(invoke).toHaveBeenCalledWith("select_team", {
      teamId: "team-1",
      activeRegionIds: ["europe"],
      activeCompetitionIds: ["ucl", "epl", "championship"],
    });
  });
});
