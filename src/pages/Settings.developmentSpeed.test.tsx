import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGameStore, type GameStateData } from "../store/gameStore";
import DevelopmentSpeedSetting from "./Settings.developmentSpeed";

const setDevelopmentSpeedMock = vi.fn();

vi.mock("../services/careerSettingsService", () => ({
  setDevelopmentSpeed: (...args: unknown[]) => setDevelopmentSpeedMock(...args),
}));

vi.mock("../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    error === "be.error.invalidDevelopmentSpeed" ? "That speed is not available." : String(error),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string) => {
      const strings: Record<string, string> = {
        "settings.developmentSpeed": "Player development speed",
        "settings.developmentSpeedDesc": "How fast players improve in this career.",
        "settings.developmentSpeedNoCareer": "Open a career to change this.",
        "settings.developmentSpeedRealistic": "Realistic",
      };
      return strings[key] ?? key;
    },
  }),
}));

function careerAt(percent?: number): GameStateData {
  return {
    manager: { id: "manager-1", nationality: "GB" },
    players: [],
    staff: [],
    development_speed: percent,
  } as unknown as GameStateData;
}

describe("DevelopmentSpeedSetting", () => {
  beforeEach(() => {
    setDevelopmentSpeedMock.mockReset();
    useGameStore.setState({ gameState: null });
  });

  it("shows the open career's speed", () => {
    useGameStore.setState({ gameState: careerAt(250) });

    render(<DevelopmentSpeedSetting />);

    expect(screen.getByRole("combobox", { name: "Player development speed" })).toHaveTextContent(
      "2.5×",
    );
  });

  it("reads a career saved before the setting existed as the realistic 1×", () => {
    useGameStore.setState({ gameState: careerAt(undefined) });

    render(<DevelopmentSpeedSetting />);

    expect(screen.getByRole("combobox", { name: "Player development speed" })).toHaveTextContent(
      "1× (Realistic)",
    );
  });

  it("offers every half step from 1× to 5×", () => {
    useGameStore.setState({ gameState: careerAt(100) });
    render(<DevelopmentSpeedSetting />);

    fireEvent.click(screen.getByRole("combobox", { name: "Player development speed" }));

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "1× (Realistic)",
      "1.5×",
      "2×",
      "2.5×",
      "3×",
      "3.5×",
      "4×",
      "4.5×",
      "5×",
    ]);
  });

  it("applies a new speed to the career and keeps the game the backend returns", async () => {
    useGameStore.setState({ gameState: careerAt(100) });
    setDevelopmentSpeedMock.mockResolvedValueOnce(careerAt(300));
    render(<DevelopmentSpeedSetting />);

    fireEvent.click(screen.getByRole("combobox", { name: "Player development speed" }));
    fireEvent.click(screen.getByRole("option", { name: "3×" }));

    expect(setDevelopmentSpeedMock).toHaveBeenCalledWith(300);
    await waitFor(() => expect(useGameStore.getState().gameState?.development_speed).toBe(300));
  });

  it("explains a refusal and leaves the career's speed alone", async () => {
    useGameStore.setState({ gameState: careerAt(100) });
    setDevelopmentSpeedMock.mockRejectedValueOnce("be.error.invalidDevelopmentSpeed");
    render(<DevelopmentSpeedSetting />);

    fireEvent.click(screen.getByRole("combobox", { name: "Player development speed" }));
    fireEvent.click(screen.getByRole("option", { name: "3×" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That speed is not available.");
    expect(useGameStore.getState().gameState?.development_speed).toBe(100);
  });

  it("cannot be changed when no career is open, and says why", () => {
    render(<DevelopmentSpeedSetting />);

    expect(screen.getByRole("combobox", { name: "Player development speed" })).toBeDisabled();
    expect(screen.getByText("Open a career to change this.")).toBeInTheDocument();
  });
});
