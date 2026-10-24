import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LicenceControls } from "../../bindings/core/rules";
import type { TacticsPhaseSettings } from "../../store/types";
import { PhaseBlueprintPanel } from "./PhaseBlueprintPanel";
import TacticsCommandBar, { type TacticsLibraryEntry } from "./TacticsCommandBar";
import type { TacticsLimits } from "./licenceLimits";

// Keys stand for the text, with their values after a colon, so a test reads which level is named.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options).join("|")}`
        : (options ?? key),
    i18n: { language: "en" },
  }),
}));

const ALL = ["4-4-2", "4-3-3", "3-5-2", "4-5-1", "4-2-3-1", "3-4-3", "5-3-2", "4-1-4-1", "3-4-2-1"];

function licence(tier: number, extra: Partial<LicenceControls>): LicenceControls {
  return { tier, formations: ALL, playStyles: [], dials: [], roles: [], ...extra };
}

const FIRST: TacticsLimits = {
  open: licence(1, { formations: ["4-4-2", "4-3-3", "3-5-2"], playStyles: ["Balanced"] }),
  table: [
    licence(1, { formations: ["4-4-2", "4-3-3", "3-5-2"], playStyles: ["Balanced"] }),
    licence(2, { playStyles: ["Balanced", "Counter"], dials: ["width"] }),
    licence(3, { playStyles: ["Balanced", "Counter"], dials: ["width"] }),
    licence(4, { playStyles: ["Balanced", "Counter"], dials: ["width", "offside_trap"] }),
  ],
  levels: { national: 2, continental: 4, elite: 7 },
};

const balanced: TacticsLibraryEntry = {
  description: "Open to all",
  formation: "4-3-3",
  id: "preset:a",
  name: "Open preset",
  playStyle: "Balanced",
  type: "preset",
};
const counter: TacticsLibraryEntry = {
  description: "Needs the second licence",
  formation: "4-2-3-1",
  id: "preset:b",
  name: "Closed preset",
  playStyle: "Counter",
  type: "preset",
};

function commandBar(limits?: TacticsLimits) {
  return render(
    <TacticsCommandBar
      activeTactic={balanced}
      activePlayStyle="Balanced"
      formation="4-3-3"
      isDirty={false}
      onCreateNew={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      onFormationChange={vi.fn()}
      onPlayStyleChange={vi.fn()}
      onSave={vi.fn()}
      onSelectTactic={vi.fn()}
      onTacticNameChange={vi.fn()}
      tacticLibrary={[balanced, counter]}
      tacticName="Open preset"
      limits={limits}
    />,
  );
}

function openList(name: string): HTMLElement {
  fireEvent.click(screen.getByRole("combobox", { name }));
  return screen.getByRole("listbox");
}

describe("the tactics board under a licence", () => {
  // Given a first-licence coach,
  // when he opens the formation list,
  // then the three open shapes can be chosen and the others are shown closed, naming level 2.
  it("shows the shapes a licence closes as closed, with the level that opens them", () => {
    commandBar(FIRST);
    const list = openList("tactics.formation");
    expect(within(list).getByRole("option", { name: "4-3-3" })).toBeEnabled();
    const closed = within(list).getByRole("option", {
      name: "tactics.licence.lockedOption:4-2-3-1|2",
    });
    expect(closed).toBeDisabled();
  });

  // Given a first-licence coach,
  // when he opens the play-style list,
  // then Counter is closed and Balanced open.
  it("shows the styles a licence closes as closed", () => {
    commandBar(FIRST);
    const list = openList("tactics.playStyle");
    expect(within(list).getByRole("option", { name: "Balanced" })).toBeEnabled();
    expect(
      within(list).getByRole("option", { name: "tactics.licence.lockedOption:Counter|2" }),
    ).toBeDisabled();
  });

  // Given no limits (offline),
  // when the formation list opens,
  // then every shape can be chosen.
  it("closes nothing without limits", () => {
    commandBar();
    const list = openList("tactics.formation");
    for (const shape of ALL) {
      expect(within(list).getByRole("option", { name: shape })).toBeEnabled();
    }
  });

  // Given a first-licence coach,
  // when he opens the tactic library,
  // then a preset of a closed shape or style cannot be chosen and says which licence opens it.
  it("closes a preset whose shape or style the licence closes", () => {
    commandBar(FIRST);
    fireEvent.click(screen.getByRole("button", { name: "tactics.chooseTactic" }));
    const library = screen.getByRole("listbox", { name: "tactics.chooseTactic" });
    expect(within(library).getByRole("option", { name: /Open preset/ })).toBeEnabled();
    const closed = within(library).getByRole("option", { name: /Closed preset/ });
    expect(closed).toBeDisabled();
    expect(within(closed).getByText(/^tactics\.licence\.lockedHint:/)).toBeInTheDocument();
  });

  // Given a first-licence coach's phase blueprint,
  // when it is shown,
  // then a closed dial cannot be changed and names the licence and level that open it, and an
  // open one can.
  it("closes the dials a licence closes", () => {
    const phase = {
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
    } as TacticsPhaseSettings;
    const second: TacticsLimits = { ...FIRST, open: FIRST.table[1] };
    render(
      <PhaseBlueprintPanel tacticsPhase={phase} onTacticsPhaseChange={vi.fn()} limits={second} />,
    );
    expect(screen.getByRole("combobox", { name: "tactics.phaseSettings.width" })).toBeEnabled();
    expect(
      screen.getByRole("combobox", { name: "tactics.phaseSettings.offsideTrap" }),
    ).toBeDisabled();
    // This table opens only the width before the fourth licence: the ten others name it.
    expect(screen.getAllByText("tactics.licence.lockedHint:tactics.licence.tier_4|7")).toHaveLength(
      10,
    );
  });
});
