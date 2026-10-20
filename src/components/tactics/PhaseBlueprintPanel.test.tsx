import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TacticsPhaseSettings } from "../../store/types";
import { PhaseBlueprintPanel } from "./PhaseBlueprintPanel";

vi.mock("react-i18next", () => {
  const translation = { t: (key: string) => key, i18n: { language: "en" } };
  return { useTranslation: () => translation };
});

const phase: TacticsPhaseSettings = {
  build_up_style: "Mixed",
  width: "Normal",
  tempo: "Patient",
  defensive_line: "Medium",
  pressing_intensity: "Medium",
  defensive_shape: "Normal",
  marking_style: "Zonal",
  counter_press_duration: "None",
  break_speed: "Medium",
  cross_style: "Mixed",
  offside_trap: "Off",
};

describe("PhaseBlueprintPanel", () => {
  // Given the without-ball settings, when the offside trap is switched on,
  // then the change asks for exactly that dial (after GĐ5).
  it("switches the offside trap on", () => {
    const onChange = vi.fn();
    render(<PhaseBlueprintPanel tacticsPhase={phase} onTacticsPhaseChange={onChange} />);
    expect(screen.getByText("tactics.phaseSettings.offsideTrap")).toBeInTheDocument();
    const trap = screen
      .getAllByRole("combobox")
      .find((select) => select.textContent === "tactics.phaseSettings.offsideTrap_Off");
    expect(trap).toBeDefined();
    fireEvent.click(trap as HTMLElement);
    fireEvent.click(screen.getByRole("option", { name: "tactics.phaseSettings.offsideTrap_On" }));
    expect(onChange).toHaveBeenCalledWith({ offside_trap: "On" });
  });
});
