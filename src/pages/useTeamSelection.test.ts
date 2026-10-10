import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData, LeagueData } from "../store/gameStore";
import { createPlayer, createTeam } from "../test-utils/factories";
import { useTeamSelection } from "./useTeamSelection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/portraitService", () => ({
  prewarmManagerSquadPortraits: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params?.defaultValue !== undefined ? String(params.defaultValue) : key,
    i18n: { language: "en" },
  }),
}));

function league(overrides: Partial<LeagueData> = {}): LeagueData {
  return {
    id: "epl",
    name: "League",
    season: 2025,
    fixtures: [],
    standings: [],
    ...overrides,
  };
}

// One region with two countries: GB holds two domestic leagues (epl, champ),
// ES holds one (laliga). The continental cup is not a domestic league and so
// never appears in the league filter.
function buildGameState(): GameStateData {
  return {
    teams: [
      createTeam({ id: "team-1", name: "Alpha FC", country: "GB", reputation: 800 }),
      createTeam({ id: "team-2", name: "Beta Town", country: "GB", reputation: 500 }),
      createTeam({ id: "team-3", name: "Gamma CF", country: "ES", reputation: 700 }),
    ],
    players: [createPlayer({ id: "p1", team_id: "team-1" })],
    regions: [{ id: "europe", name: "Europe", country_codes: ["GB", "ES"] }],
    competitions: [
      league({
        id: "ucl",
        scope: "Continental",
        kind: "Cup",
        participant_ids: ["team-1", "team-3"],
        priority: 0,
      }),
      league({
        id: "epl",
        scope: "Domestic",
        kind: "League",
        country_id: "GB",
        participant_ids: ["team-1"],
        priority: 1,
      }),
      league({
        id: "champ",
        scope: "Domestic",
        kind: "League",
        country_id: "GB",
        participant_ids: ["team-2"],
        priority: 2,
      }),
      league({
        id: "laliga",
        scope: "Domestic",
        kind: "League",
        country_id: "ES",
        participant_ids: ["team-3"],
        priority: 1,
      }),
    ],
    league: null,
    manager: { first_name: "Sam", last_name: "Boss" },
  } as unknown as GameStateData;
}

function renderController() {
  // Build the game state once so the hook receives a stable reference across
  // re-renders (the real store does the same); a fresh object each render would
  // retrigger the region/competition memos and loop the sync effects.
  const gameState = buildGameState();
  const externals = {
    setGameState: vi.fn(),
    setGameActive: vi.fn(),
    navigate: vi.fn(),
  };
  return renderHook(() => useTeamSelection({ gameState, ...externals }));
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe("useTeamSelection league filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Given a fresh page, When it mounts, Then the first region and country are picked with no league filter. */
  it("starts on the first region and country with every league shown", () => {
    const { result } = renderController();

    expect(result.current.selectedHomeRegionId).toBe("europe");
    expect(result.current.selectedCountryCode).toBe("GB");
    expect(result.current.selectedLeagueId).toBeNull();
    expect(ids(result.current.filteredTeams)).toEqual(["team-1", "team-2"]);
  });

  /** Given a country, When the league options are listed, Then only its domestic leagues appear. */
  it("offers only the selected country's domestic leagues", () => {
    const { result } = renderController();

    expect(ids(result.current.leagueOptions)).toEqual(["epl", "champ"]);

    act(() => result.current.setSelectedCountryCode("ES"));

    expect(ids(result.current.leagueOptions)).toEqual(["laliga"]);
  });

  /** Given a league is picked, When clubs are listed, Then only that league's clubs remain. */
  it("narrows the clubs to the picked league", () => {
    const { result } = renderController();

    act(() => result.current.setSelectedLeagueId("champ"));

    expect(ids(result.current.filteredTeams)).toEqual(["team-2"]);
    expect(result.current.selectedTeam?.id).toBe("team-2");
  });

  /** Given a league is picked, When the country changes, Then the stale league stops filtering. */
  it("drops a league that does not belong to the newly selected country", () => {
    const { result } = renderController();

    act(() => result.current.setSelectedLeagueId("epl"));
    act(() => result.current.setSelectedCountryCode("ES"));

    expect(result.current.selectedLeagueId).toBeNull();
    expect(ids(result.current.filteredTeams)).toEqual(["team-3"]);
  });
});
