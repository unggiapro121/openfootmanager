import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../context/ThemeContext";
import type { GameStateData } from "../../store/gameStore";
import HalfTimeBreak from "./HalfTimeBreak";
import type { EnginePlayerData, MatchSnapshot } from "./types";
import { changeMatchPlayerRole, swapMatchPositions } from "../../services/liveMatchService";
import { setPlayerRole } from "../../services/squadService";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../services/liveMatchService", () => ({
  swapMatchPositions: vi.fn(),
  changeMatchPlayerRole: vi.fn(),
}));
vi.mock("../../services/squadService", () => ({ setPlayerRole: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// jsdom doesn't implement matchMedia, which ThemeProvider reads on mount.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const XI_POSITIONS = [
  "Goalkeeper",
  "Defender",
  "Defender",
  "Defender",
  "Defender",
  "Midfielder",
  "Midfielder",
  "Midfielder",
  "Midfielder",
  "Forward",
  "Forward",
];

function team(id: string) {
  return {
    id,
    name: id,
    formation: "4-4-2",
    play_style: "Balanced",
    players: XI_POSITIONS.map(
      (position, index) =>
        ({
          id: `${id}-p${index}`,
          name: `${id} ${index}`,
          position,
          ovr: 70,
          condition: 90,
          traits: [],
          role: "Standard",
        }) as unknown as EnginePlayerData,
    ),
  };
}

function snapshot(): MatchSnapshot {
  return {
    phase: "HalfTime",
    current_minute: 45,
    home_score: 0,
    away_score: 1,
    possession: "Home",
    ball_zone: "Midfield",
    home_possession_pct: 52,
    away_possession_pct: 48,
    home_yellows: {},
    away_yellows: {},
    home_team: team("home"),
    away_team: team("away"),
    home_bench: [],
    away_bench: [],
    events: [],
    home_subs_made: 0,
    away_subs_made: 0,
    max_subs: 5,
    substitutions: [],
    sent_off: ["home-p2"],
  } as unknown as MatchSnapshot;
}

describe("HalfTimeBreak", () => {
  // Given the half-time break, when a player is dragged onto the sent-off
  // player's slot on the lineup pitch, then their positions are traded and the
  // match view is refreshed with the result.
  it("swaps positions on the half-time lineup pitch", async () => {
    const updated = { ...snapshot(), current_minute: 46 };
    vi.mocked(swapMatchPositions).mockResolvedValue(updated);
    const onUpdateSnapshot = vi.fn();
    render(
      <ThemeProvider>
        <HalfTimeBreak
          snapshot={snapshot()}
          gameState={{ teams: [] } as unknown as GameStateData}
          userSide="Home"
          isSpectator={false}
          importantEvents={[]}
          onResume={vi.fn()}
          onUpdateSnapshot={onUpdateSnapshot}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("match.lineups")).toBeInTheDocument();
    const dataTransfer = {
      setData: vi.fn(),
      getData: () => "home-p9",
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(screen.getByTestId("pitch-token-home-p9"), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId("pitch-token-home-p2"), { dataTransfer });
    fireEvent.drop(screen.getByTestId("pitch-token-home-p2"), { dataTransfer });

    expect(swapMatchPositions).toHaveBeenCalledWith("Home", "home-p9", "home-p2");
    await waitFor(() => expect(onUpdateSnapshot).toHaveBeenCalledWith(updated));
  });

  // Given the half-time lineup pitch, when a player's role is picked under his
  // token, then the role changes for this match and is kept on the player.
  it("changes a player's role on the half-time pitch", async () => {
    const updated = snapshot();
    vi.mocked(changeMatchPlayerRole).mockResolvedValue(updated);
    vi.mocked(setPlayerRole).mockResolvedValue({} as never);
    const onUpdateSnapshot = vi.fn();
    render(
      <ThemeProvider>
        <HalfTimeBreak
          snapshot={snapshot()}
          gameState={{ teams: [] } as unknown as GameStateData}
          userSide="Home"
          isSpectator={false}
          importantEvents={[]}
          onResume={vi.fn()}
          onUpdateSnapshot={onUpdateSnapshot}
        />
      </ThemeProvider>,
    );

    const token = screen.getByTestId("pitch-token-home-p9");
    fireEvent.click(within(token).getByRole("combobox", { name: "tactics.playerRoleLabel" }));
    fireEvent.click(screen.getByRole("option", { name: "tactics.playerRoles.Poacher" }));

    expect(changeMatchPlayerRole).toHaveBeenCalledWith("Home", "home-p9", "Poacher");
    await waitFor(() => expect(onUpdateSnapshot).toHaveBeenCalledWith(updated));
    expect(setPlayerRole).toHaveBeenCalledWith("home-p9", "Poacher");
  });
});
