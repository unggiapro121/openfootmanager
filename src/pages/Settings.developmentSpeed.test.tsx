import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEVELOPMENT_SPEED_PERCENTS, formatDevelopmentSpeed } from "../lib/developmentSpeed";
import { useGameStore, type GameStateData } from "../store/gameStore";
import DevelopmentSpeedSetting from "./Settings.developmentSpeed";

const strings: Record<string, string> = {
  "settings.developmentSpeed": "Player development speed",
  "settings.developmentSpeedDesc": "Chosen when this career was created.",
  "settings.developmentSpeedNoCareer": "Open a career to see this.",
  "settings.developmentSpeedRealistic": "Realistic",
};
const t = (key: string) => strings[key] ?? key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t }),
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
    useGameStore.setState({ gameState: null });
  });

  /** Given a career created at ×2.5, then Settings shows ×2.5 and offers no way to change it. */
  it("shows the open career's speed without a control to change it", () => {
    useGameStore.setState({ gameState: careerAt(250) });

    render(<DevelopmentSpeedSetting />);

    expect(screen.getByText("×2.5")).toBeInTheDocument();
    expect(screen.getByText("Chosen when this career was created.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  /** Given a career saved before the setting existed, then it reads as the realistic ×1. */
  it("reads a career saved before the setting existed as the realistic ×1", () => {
    useGameStore.setState({ gameState: careerAt(undefined) });

    render(<DevelopmentSpeedSetting />);

    expect(screen.getByText("×1 (Realistic)")).toBeInTheDocument();
  });

  /** Given no career open, then there is no speed to show, and the row says why. */
  it("shows nothing to read when no career is open", () => {
    render(<DevelopmentSpeedSetting />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Open a career to see this.")).toBeInTheDocument();
  });
});

describe("formatDevelopmentSpeed", () => {
  /** Every step on the scale, in the reader's number format, ×1 marked realistic. */
  it("labels every half step from ×1 to ×5", () => {
    expect(
      DEVELOPMENT_SPEED_PERCENTS.map((percent) => formatDevelopmentSpeed(percent, t, "en")),
    ).toEqual(["×1 (Realistic)", "×1.5", "×2", "×2.5", "×3", "×3.5", "×4", "×4.5", "×5"]);
    expect(formatDevelopmentSpeed(150, t, "vi")).toBe("×1,5");
  });
});
